import { vocalVolumeToGain } from '@shared/controls';
import { midiToHz, type PitchTargetData } from '@shared/music';
import { describe, expect, it } from 'vitest';
import { LIMITER_CEILING } from './effects/limiter';
import {
  firstDelayedDifference,
  firstDifference,
  mean,
  peak,
  rms,
  trackPitchCents,
} from './testing/measure';
import { createRandom } from './testing/random';
import { synthesizeVoice, whiteNoise } from './testing/syntheticVoice';
import {
  DEFAULT_VOCAL_CHAIN_CONTROLS,
  VocalChain,
  type VocalChainControls,
  type VocalChainMeters,
} from './vocalChain';

const SAMPLE_RATE = 48000;

interface Stereo {
  left: Float32Array;
  right: Float32Array;
}

interface RenderOptions {
  chain?: VocalChain;
  controls?: Partial<VocalChainControls>;
  blockSizeAt?: (offset: number) => number;
  /** Song time of the first input sample; omit for "no song clock". */
  songStartSec?: number;
  onBlock?: (chain: VocalChain, endSec: number) => void;
}

function render(input: Float32Array, options: RenderOptions = {}): Stereo {
  const chain = options.chain ?? new VocalChain({ sampleRate: SAMPLE_RATE });
  if (options.controls) chain.setControls(options.controls);
  const left = new Float32Array(input.length);
  const right = new Float32Array(input.length);
  for (let offset = 0; offset < input.length;) {
    const frames = Math.min(options.blockSizeAt?.(offset) ?? 128, input.length - offset);
    if (options.songStartSec !== undefined) {
      chain.setSongPosition(options.songStartSec + offset / SAMPLE_RATE);
    }
    chain.process(
      input.subarray(offset, offset + frames),
      left.subarray(offset, offset + frames),
      right.subarray(offset, offset + frames),
    );
    offset += frames;
    options.onBlock?.(chain, offset / SAMPLE_RATE);
  }
  return { left, right };
}

function emptyMeters(): VocalChainMeters {
  return { inputPeak: -1, outputPeak: -1, detectedMidi: 0, targetMidi: 0, correctionCents: -1 };
}

const voice = synthesizeVoice({
  sampleRate: SAMPLE_RATE,
  durationSec: 2,
  midi: 56.6,
  vibratoCents: 30,
  jitterCents: 3,
  breathLevel: 0.05,
});

const EVERYTHING_ON: VocalChainControls = {
  autotune: 1,
  echo: 1,
  volume: 0.8,
  micGain: 1.2,
  reverbEnabled: true,
};

describe('VocalChain with default controls', () => {
  it('starts with every effect off and unity gains', () => {
    expect(DEFAULT_VOCAL_CHAIN_CONTROLS).toEqual({
      autotune: 0,
      echo: 0,
      volume: 0.5,
      micGain: 1,
      reverbEnabled: false,
    });
  });

  it('passes the voice through untouched, delayed by its latency, on both channels', () => {
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    const { left, right } = render(voice, { chain });
    expect(firstDelayedDifference(left, voice, chain.latencySamples)).toBe(-1);
    expect(firstDifference(right, left)).toBe(-1);
    expect(peak(left, 0, chain.latencySamples)).toBe(0);
  });

  it('reports a nominal latency of 5 ms', () => {
    expect(new VocalChain({ sampleRate: SAMPLE_RATE }).latencySamples).toBe(240);
    expect(new VocalChain({ sampleRate: 44100 }).latencySamples / 44100).toBeCloseTo(0.005, 4);
  });

  it('accepts the input buffer as one of its output buffers', () => {
    const reference = render(voice);
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    const inPlace = Float32Array.from(voice);
    const right = new Float32Array(voice.length);
    for (let offset = 0; offset < voice.length; offset += 128) {
      const block = inPlace.subarray(offset, offset + 128);
      chain.process(block, block, right.subarray(offset, offset + 128));
    }
    expect(firstDifference(inPlace, reference.left)).toBe(-1);
    expect(firstDifference(right, reference.right)).toBe(-1);
  });
});

describe('VocalChain controls', () => {
  const tone = new Float32Array(SAMPLE_RATE);
  for (let n = 0; n < tone.length; n++)
    tone[n] = 0.1 * Math.sin((2 * Math.PI * 330 * n) / SAMPLE_RATE);
  const settled = SAMPLE_RATE / 2;
  const gainDb = (output: Float32Array) =>
    20 * Math.log10(rms(output, settled) / rms(tone, settled));

  it('maps vocal volume to -12 dB … 0 dB … +5 dB', () => {
    expect(gainDb(render(tone, { controls: { volume: 0 } }).left)).toBeCloseTo(-12, 2);
    expect(gainDb(render(tone, { controls: { volume: 0.25 } }).left)).toBeCloseTo(-6, 2);
    expect(gainDb(render(tone, { controls: { volume: 0.5 } }).left)).toBeCloseTo(0, 6);
    expect(gainDb(render(tone, { controls: { volume: 1 } }).left)).toBeCloseTo(5, 2);
    expect(gainDb(render(tone, { controls: { volume: 7 } }).left)).toBeCloseTo(5, 2);
    expect(vocalVolumeToGain(1)).toBeCloseTo(10 ** (5 / 20), 9);
  });

  it('applies the microphone trim linearly, limited to 0..2', () => {
    expect(peak(render(tone, { controls: { micGain: 0 } }).left, settled)).toBe(0);
    expect(gainDb(render(tone, { controls: { micGain: 0.5 } }).left)).toBeCloseTo(-6.02, 2);
    expect(gainDb(render(tone, { controls: { micGain: 2 } }).left)).toBeCloseTo(6.02, 2);
    expect(gainDb(render(tone, { controls: { micGain: 50 } }).left)).toBeCloseTo(6.02, 2);
    expect(peak(render(tone, { controls: { micGain: -3 } }).left, settled)).toBe(0);
  });

  it('glides to new values instead of stepping (no zipper noise)', () => {
    const constant = new Float32Array(SAMPLE_RATE / 2).fill(0.2);
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    const { left } = render(constant, {
      chain,
      onBlock: (_, endSec) => {
        if (endSec > 0.1) chain.setControls({ volume: 1, micGain: 0.5 });
      },
    });
    let largestStep = 0;
    for (let n = chain.latencySamples + 1; n < left.length; n++) {
      largestStep = Math.max(largestStep, Math.abs(left[n]! - left[n - 1]!));
    }
    expect(left[left.length - 1]).toBeCloseTo(0.2 * 0.5 * vocalVolumeToGain(1), 4);
    expect(largestStep).toBeLessThan(0.001);
  });

  it('only changes the controls that are given, and ignores NaN', () => {
    const reference = render(voice, { controls: { echo: 0.6, volume: 0.3 } });
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    chain.setControls({ echo: 0.6 });
    chain.setControls({ volume: 0.3 });
    chain.setControls({});
    chain.setControls({
      autotune: Number.NaN,
      echo: Number.NaN,
      volume: Number.NaN,
      micGain: Number.NaN,
    });
    const { left, right } = render(voice, { chain });
    expect(firstDifference(left, reference.left)).toBe(-1);
    expect(firstDifference(right, reference.right)).toBe(-1);
  });

  it('turns each effect on with its control', () => {
    const dry = render(voice);
    const from = SAMPLE_RATE;
    const echoed = render(voice, { controls: { echo: 1 } });
    expect(rms(echoed.left, from)).toBeGreaterThan(1.05 * rms(dry.left, from));
    expect(firstDifference(echoed.left, echoed.right)).toBeGreaterThanOrEqual(0);

    const reverberated = render(voice, { controls: { reverbEnabled: true } });
    expect(firstDifference(reverberated.left, dry.left)).toBeGreaterThanOrEqual(0);
    expect(firstDifference(reverberated.left, reverberated.right)).toBeGreaterThanOrEqual(0);

    const tuned = render(voice, { controls: { autotune: 1 } });
    const pitchOf = (signal: Float32Array) =>
      mean(
        trackPitchCents(signal, {
          sampleRate: SAMPLE_RATE,
          startSec: 1,
          endSec: 1.8,
          referenceHz: midiToHz(57),
          windowSec: 3 / midiToHz(57),
        }),
      );
    expect(pitchOf(dry.left)).toBeLessThan(-35);
    expect(Math.abs(pitchOf(tuned.left))).toBeLessThan(5);
    expect(firstDifference(tuned.left, tuned.right)).toBe(-1);
  });
});

describe('VocalChain autotune targets', () => {
  // The singer is at 56.6. Nearest semitone: A (57). The song's melody has G (55) there.
  const song: PitchTargetData = {
    notes: Float32Array.of(20, 30, 55),
    key: { tonic: 0, mode: 'major', confidence: 1 },
    tuningCents: 0,
  };
  const targetAt = (options: RenderOptions): number => {
    const meters = emptyMeters();
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    chain.setPitchTargets(song);
    render(voice, { ...options, chain, controls: { autotune: 1 } });
    chain.readMeters(meters);
    return meters.targetMidi;
  };

  it('follows the melody at the given song position', () => {
    expect(targetAt({ songStartSec: 21 })).toBe(55);
  });

  it('uses only the key when the position is null or outside the melody', () => {
    expect(targetAt({})).toBe(57);
    expect(targetAt({ songStartSec: 100 })).toBe(57);
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    chain.setPitchTargets(song);
    chain.setControls({ autotune: 1 });
    chain.setSongPosition(21);
    chain.setSongPosition(null);
    render(voice, { chain });
    const meters = emptyMeters();
    chain.readMeters(meters);
    expect(meters.targetMidi).toBe(57);
  });

  it('goes back to the nearest semitone when the targets are removed', () => {
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    chain.setPitchTargets({
      notes: new Float32Array(0),
      key: { tonic: 1, mode: 'major', confidence: 1 },
      tuningCents: 0,
    });
    chain.setControls({ autotune: 1 });
    const meters = emptyMeters();
    render(voice, { chain });
    chain.readMeters(meters);
    // D♭ major has A♭ (56) but no A.
    expect(meters.targetMidi).toBe(56);
    chain.setPitchTargets(null);
    render(voice, { chain });
    chain.readMeters(meters);
    expect(meters.targetMidi).toBe(57);
  });
});

describe('VocalChain meters', () => {
  it('reports the peaks since the last read and then starts over', () => {
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    chain.setControls({ micGain: 0.5 });
    chain.reset();
    const meters = emptyMeters();
    render(voice, { chain });
    chain.readMeters(meters);
    expect(meters.inputPeak).toBeCloseTo(0.5 * peak(voice), 5);
    expect(meters.outputPeak).toBeCloseTo(
      0.5 * peak(voice, 0, voice.length - chain.latencySamples),
      5,
    );
    chain.readMeters(meters);
    expect(meters.inputPeak).toBe(0);
    expect(meters.outputPeak).toBe(0);
  });

  it('reports the sung note, the target and the correction while autotune is on', () => {
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    const meters = emptyMeters();
    const detected: number[] = [];
    const corrections: number[] = [];
    render(voice, {
      chain,
      controls: { autotune: 1 },
      onBlock: (_, endSec) => {
        chain.readMeters(meters);
        if (endSec < 0.5) return;
        detected.push(meters.detectedMidi);
        corrections.push(meters.correctionCents);
        expect(meters.targetMidi).toBe(57);
      },
    });
    expect(mean(detected)).toBeCloseTo(56.6, 1);
    expect(mean(corrections)).toBeGreaterThan(35);
    expect(mean(corrections)).toBeLessThan(45);
  });

  it('reports NaN notes and no correction when nobody is singing', () => {
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    const meters = emptyMeters();
    render(whiteNoise(SAMPLE_RATE, 0.5, 0.05, 2), { chain, controls: { autotune: 1 } });
    chain.readMeters(meters);
    expect(Number.isNaN(meters.detectedMidi)).toBe(true);
    expect(Number.isNaN(meters.targetMidi)).toBe(true);
    expect(meters.correctionCents).toBe(0);
  });
});

describe('VocalChain safety', () => {
  it('never exceeds the limiter ceiling, however hard it is driven', () => {
    const loud = synthesizeVoice({
      sampleRate: SAMPLE_RATE,
      durationSec: 4,
      midi: (timeSec) => 50 + 3 * Math.floor(timeSec * 2),
      level: 0.6,
      breathLevel: 0.2,
    });
    const { left, right } = render(loud, {
      controls: { autotune: 1, echo: 1, volume: 1, micGain: 2, reverbEnabled: true },
    });
    const ceiling = Math.fround(LIMITER_CEILING);
    expect(peak(left)).toBeLessThanOrEqual(ceiling);
    expect(peak(right)).toBeLessThanOrEqual(ceiling);
    expect(peak(left)).toBeGreaterThan(0.9);
    expect(ceiling).toBeLessThan(1);
  });

  it('never outputs NaN or Infinity, whatever comes in, and recovers afterwards', () => {
    const random = createRandom(99);
    const garbage = [Number.NaN, Infinity, -Infinity, 1e30, -1e30, 1e-40, -4.9e-324, 0, 37, -1];
    const input = Float32Array.from(voice);
    const garbageUntil = SAMPLE_RATE;
    for (let n = 0; n < garbageUntil; n++) {
      if (random() < 0.3) input[n] = garbage[Math.floor(random() * garbage.length)]!;
    }
    for (let n = 2000; n < 2600; n++) input[n] = Number.NaN;

    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    const meters = emptyMeters();
    const { left, right } = render(input, {
      chain,
      controls: EVERYTHING_ON,
      songStartSec: 0,
      onBlock: () => {
        chain.readMeters(meters);
        expect(Number.isFinite(meters.inputPeak)).toBe(true);
        expect(Number.isFinite(meters.outputPeak)).toBe(true);
        expect(Number.isFinite(meters.correctionCents)).toBe(true);
      },
    });
    for (const channel of [left, right]) {
      expect(channel.every((sample) => Number.isFinite(sample))).toBe(true);
      expect(peak(channel)).toBeLessThanOrEqual(Math.fround(LIMITER_CEILING));
    }
    // Once the garbage stops the voice comes through again, tuned.
    const track = trackPitchCents(left, {
      sampleRate: SAMPLE_RATE,
      startSec: 1.5,
      endSec: 1.9,
      referenceHz: midiToHz(57),
      windowSec: 3 / midiToHz(57),
    });
    expect(Math.abs(mean(track))).toBeLessThan(15);
    expect(rms(left, 1.5 * SAMPLE_RATE)).toBeGreaterThan(0.05);
  });

  it('survives hostile control values', () => {
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    chain.setControls({ autotune: Infinity, echo: -Infinity, volume: 1e9, micGain: -1e9 });
    chain.setSongPosition(Number.NaN);
    chain.setSongPosition(Infinity);
    chain.setPitchTargets({ notes: Float32Array.of(0, 1), key: null, tuningCents: Number.NaN });
    const { left } = render(voice, { chain });
    expect(left.every((sample) => Number.isFinite(sample))).toBe(true);
  });

  it('handles blocks of any length from 1 to 4096, and an empty block', () => {
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    chain.setControls(EVERYTHING_ON);
    chain.process(new Float32Array(0), new Float32Array(0), new Float32Array(0));
    for (const length of [1, 2, 127, 128, 129, 1000, 4096]) {
      const left = new Float32Array(length);
      const right = new Float32Array(length);
      chain.process(voice.subarray(0, length), left, right);
      expect(left.every((sample) => Number.isFinite(sample))).toBe(true);
      expect(right.every((sample) => Number.isFinite(sample))).toBe(true);
    }
  });
});

describe('VocalChain streaming behaviour', () => {
  // A phrase with note changes, a rest and a restart, so every state machine is exercised.
  const phrase = synthesizeVoice({
    sampleRate: SAMPLE_RATE,
    durationSec: 4,
    midi: (timeSec) => {
      if (timeSec > 1.6 && timeSec < 2.1) return Number.NaN;
      return [56.7, 59.2, 60.4, 57.8][Math.floor(timeSec * 2) % 4]!;
    },
    vibratoCents: 25,
    jitterCents: 5,
    breathLevel: 0.1,
    level: 0.25,
  });
  const song: PitchTargetData = {
    notes: Float32Array.of(10.0, 10.5, 57, 10.5, 11.0, 59, 11.0, 11.5, 60, 12.2, 12.6, 62),
    key: { tonic: 9, mode: 'minor', confidence: 0.8 },
    tuningCents: 12,
  };
  const prepared = (): VocalChain => {
    const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
    chain.setPitchTargets(song);
    return chain;
  };

  it('gives bit-identical output for 128-frame blocks and for odd block sizes', () => {
    const reference = render(phrase, {
      chain: prepared(),
      controls: EVERYTHING_ON,
      songStartSec: 10,
    });
    expect(rms(reference.left, SAMPLE_RATE)).toBeGreaterThan(0.05);

    const random = createRandom(2024);
    const schemes: Record<string, (offset: number) => number> = {
      'one frame at a time for a while, then 4096': (offset) => (offset < 3000 ? 1 : 4096),
      'prime-sized blocks': () => 127,
      'random sizes from 1 to 700': () => 1 + Math.floor(random() * 700),
      'a single huge block': () => phrase.length,
    };
    for (const [name, blockSizeAt] of Object.entries(schemes)) {
      const { left, right } = render(phrase, {
        chain: prepared(),
        controls: EVERYTHING_ON,
        songStartSec: 10,
        blockSizeAt,
      });
      expect(firstDifference(left, reference.left), name).toBe(-1);
      expect(firstDifference(right, reference.right), name).toBe(-1);
    }
  });

  it('is deterministic', () => {
    const first = render(phrase, { chain: prepared(), controls: EVERYTHING_ON, songStartSec: 10 });
    const second = render(phrase, { chain: prepared(), controls: EVERYTHING_ON, songStartSec: 10 });
    expect(firstDifference(second.left, first.left)).toBe(-1);
    expect(firstDifference(second.right, first.right)).toBe(-1);
  });

  it('clears echoes, reverb and pitch tracking on reset but keeps the controls', () => {
    const chain = prepared();
    chain.setControls(EVERYTHING_ON);
    chain.reset();
    const first = render(phrase, { chain, songStartSec: 10 });
    chain.reset();
    // Straight after a reset there is nothing left to ring.
    const silence = render(new Float32Array(SAMPLE_RATE / 4), { chain });
    expect(peak(silence.left)).toBe(0);
    expect(peak(silence.right)).toBe(0);
    chain.reset();
    const second = render(phrase, { chain, songStartSec: 10 });
    expect(firstDifference(second.left, first.left)).toBe(-1);
    expect(firstDifference(second.right, first.right)).toBe(-1);
  });
});

describe('VocalChain performance', () => {
  it('processes 10 s of audio in 128-frame blocks in well under a second', async ({ annotate }) => {
    const seconds = 10;
    const input = synthesizeVoice({
      sampleRate: SAMPLE_RATE,
      durationSec: seconds,
      midi: (timeSec) => 50 + 2 * (Math.floor(timeSec * 2) % 8),
      vibratoCents: 40,
      jitterCents: 8,
      breathLevel: 0.1,
      level: 0.2,
    });
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    let bestMs = Infinity;
    let worstBlockMs = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const chain = new VocalChain({ sampleRate: SAMPLE_RATE });
      chain.setControls(EVERYTHING_ON);
      let slowestBlockMs = 0;
      const startedAt = performance.now();
      for (let offset = 0; offset + 128 <= input.length; offset += 128) {
        const blockStartedAt = performance.now();
        chain.process(input.subarray(offset, offset + 128), left, right);
        slowestBlockMs = Math.max(slowestBlockMs, performance.now() - blockStartedAt);
      }
      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs < bestMs) {
        bestMs = elapsedMs;
        worstBlockMs = slowestBlockMs;
      }
    }
    const blockBudgetMs = (128 / SAMPLE_RATE) * 1000;
    await annotate(
      `all effects on: ${seconds} s processed in ${bestMs.toFixed(0)} ms ` +
        `(${((seconds * 1000) / bestMs).toFixed(0)}× realtime); slowest block ` +
        `${worstBlockMs.toFixed(3)} ms of a ${blockBudgetMs.toFixed(2)} ms budget`,
    );
    expect(bestMs).toBeLessThan(500);
  });
});
