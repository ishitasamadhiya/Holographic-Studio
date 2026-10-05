import { midiToHz } from '@shared/music';
import { describe, expect, it } from 'vitest';
import { semitonesToRatio } from '../math';
import {
  centsBetween,
  firstDelayedDifference,
  firstDifference,
  maxSecondDifference,
  maxStep,
  measurePitch,
  rms,
} from '../testing/measure';
import { synthesizeVoice, whiteNoise } from '../testing/syntheticVoice';
import { PitchShifter } from './pitchShifter';

const SAMPLE_RATE = 48000;

interface ShiftResult {
  output: Float32Array;
  shifter: PitchShifter;
  minDelay: number;
  maxDelay: number;
}

/** Frames per call; small enough to watch the delay move, odd enough to be no special case. */
const BLOCK = 50;

function shift(
  input: Float32Array,
  ratioAt: (sample: number) => number,
  periodSamples: number | null,
): ShiftResult {
  const shifter = new PitchShifter({ sampleRate: SAMPLE_RATE });
  if (periodSamples !== null) shifter.setPeriod(periodSamples);
  const output = Float32Array.from(input);
  const ratios = new Float32Array(BLOCK);
  let minDelay = Infinity;
  let maxDelay = 0;
  for (let offset = 0; offset < input.length; offset += BLOCK) {
    const frames = Math.min(BLOCK, input.length - offset);
    for (let i = 0; i < frames; i++) ratios[i] = ratioAt(offset + i);
    shifter.process(output, offset, frames, ratios);
    minDelay = Math.min(minDelay, shifter.delaySamples);
    maxDelay = Math.max(maxDelay, shifter.delaySamples);
  }
  return { output, shifter, minDelay, maxDelay };
}

const voices = new Map<number, Float32Array>();
function voiceAt(f0Hz: number): Float32Array {
  let voice = voices.get(f0Hz);
  if (!voice) {
    voice = synthesizeVoice({
      sampleRate: SAMPLE_RATE,
      durationSec: 0.7,
      midi: 69 + 12 * Math.log2(f0Hz / 440),
    });
    voices.set(f0Hz, voice);
  }
  return voice;
}

/** The analysis region: after the start-up transient, before the end of the signal. */
const FROM = Math.round(0.15 * SAMPLE_RATE);
const LENGTH = Math.round(0.4 * SAMPLE_RATE);

describe('PitchShifter at ratio 1', () => {
  it('outputs the input delayed by its nominal latency, bit for bit', () => {
    for (const input of [voiceAt(220), whiteNoise(SAMPLE_RATE, 0.5, 0.2, 5)]) {
      const { output, shifter } = shift(input, () => 1, null);
      const latency = shifter.latencySamples;
      expect(output.subarray(0, latency).every((sample) => sample === 0)).toBe(true);
      expect(firstDelayedDifference(output, input, latency)).toBe(-1);
      expect(shifter.spliceCount).toBe(0);
      expect(shifter.delaySamples).toBe(latency);
    }
  });

  it('has a nominal latency of 5 ms', () => {
    expect(new PitchShifter({ sampleRate: SAMPLE_RATE }).latencySamples).toBe(240);
    expect(new PitchShifter({ sampleRate: 44100 }).latencySamples).toBe(221);
  });

  it('stays transparent while the period it is told about changes', () => {
    const input = voiceAt(220);
    const shifter = new PitchShifter({ sampleRate: SAMPLE_RATE });
    const output = Float32Array.from(input);
    const unity = new Float32Array(240).fill(1);
    for (let offset = 0; offset + 240 <= input.length; offset += 240) {
      shifter.setPeriod(60 + ((offset * 7) % 700));
      shifter.process(output, offset, 240, unity);
    }
    expect(firstDelayedDifference(output, input, 240)).toBe(-1);
    expect(shifter.spliceCount).toBe(0);
  });
});

describe('PitchShifter accuracy and cleanliness', () => {
  const pitches = [100, 155, 220, 330, 466, 800];
  const shifts = [-3, -1, -0.25, 0.25, 1, 3];

  it('shifts by the requested interval to within a cent', () => {
    let worst = 0;
    for (const f0Hz of pitches) {
      for (const semitones of shifts) {
        const ratio = semitonesToRatio(semitones);
        const { output } = shift(voiceAt(f0Hz), () => ratio, SAMPLE_RATE / f0Hz);
        const measured = measurePitch(output, SAMPLE_RATE, FROM, LENGTH, f0Hz * ratio, 80);
        const error = Math.abs(centsBetween(measured.hz, f0Hz * ratio));
        expect(error, `${f0Hz} Hz, ${semitones} st`).toBeLessThan(1);
        worst = Math.max(worst, error);
      }
    }
    expect(worst).toBeLessThan(1);
  });

  it('leaves no clicks or splice artifacts: the output is as periodic and as smooth as the input', () => {
    for (const f0Hz of pitches) {
      const input = voiceAt(f0Hz);
      const inputStep = maxStep(input, FROM, FROM + LENGTH);
      const inputLevel = rms(input, FROM, FROM + LENGTH);
      for (const semitones of shifts) {
        const ratio = semitonesToRatio(semitones);
        const { output, shifter } = shift(input, () => ratio, SAMPLE_RATE / f0Hz);
        const label = `${f0Hz} Hz, ${semitones} st`;
        expect(shifter.spliceCount, label).toBeGreaterThan(0);

        // A click would add a sample-to-sample jump the input (resampled) does not have.
        const step = maxStep(output, FROM, FROM + LENGTH);
        expect(step / (inputStep * ratio), label).toBeLessThan(1.1);

        // Anything a splice adds is not periodic: 1 - periodicity is the artifact energy
        // relative to the signal. Checked over short windows so one bad splice cannot hide.
        const windowSamples = Math.round((4 * SAMPLE_RATE) / (f0Hz * ratio));
        let worstPeriodicity = 1;
        for (let start = FROM; start < FROM + LENGTH; start += windowSamples) {
          const local = measurePitch(output, SAMPLE_RATE, start, windowSamples, f0Hz * ratio, 60);
          worstPeriodicity = Math.min(worstPeriodicity, local.periodicity);
        }
        expect(1 - worstPeriodicity, label).toBeLessThan(0.001);

        expect(rms(output, FROM, FROM + LENGTH) / inputLevel, label).toBeGreaterThan(0.98);
        expect(rms(output, FROM, FROM + LENGTH) / inputLevel, label).toBeLessThan(1.02);
      }
    }
  });

  it('stays clean when the period it is told is a few percent wrong', () => {
    for (const f0Hz of [110, 220, 440]) {
      for (const periodError of [0.97, 1.03]) {
        for (const semitones of [-2, 2]) {
          const ratio = semitonesToRatio(semitones);
          const input = voiceAt(f0Hz);
          const { output } = shift(input, () => ratio, (SAMPLE_RATE / f0Hz) * periodError);
          const label = `${f0Hz} Hz, period × ${periodError}, ${semitones} st`;
          const windowSamples = Math.round((4 * SAMPLE_RATE) / (f0Hz * ratio));
          let worstPeriodicity = 1;
          for (let start = FROM; start < FROM + LENGTH; start += windowSamples) {
            const local = measurePitch(output, SAMPLE_RATE, start, windowSamples, f0Hz * ratio, 60);
            worstPeriodicity = Math.min(worstPeriodicity, local.periodicity);
          }
          expect(1 - worstPeriodicity, label).toBeLessThan(0.001);
          const step = maxStep(output, FROM, FROM + LENGTH);
          expect(step / (maxStep(input, FROM, FROM + LENGTH) * ratio), label).toBeLessThan(1.1);
        }
      }
    }
  });

  it('follows a ratio that changes continuously without clicks', () => {
    const f0Hz = 220;
    const input = voiceAt(f0Hz);
    // Half a semitone up with ±60 cents at 6 Hz on top: a flat singer with vibrato, hard-tuned.
    const ratioAt = (n: number) =>
      semitonesToRatio(0.5 + 0.6 * Math.sin((2 * Math.PI * 6 * n) / SAMPLE_RATE));
    const { output, shifter } = shift(input, ratioAt, SAMPLE_RATE / f0Hz);
    expect(shifter.spliceCount).toBeGreaterThan(2);
    const step = maxStep(output, FROM, FROM + LENGTH);
    expect(step / (maxStep(input, FROM, FROM + LENGTH) * semitonesToRatio(1.1))).toBeLessThan(1.1);
    const level = rms(output, FROM, FROM + LENGTH) / rms(input, FROM, FROM + LENGTH);
    expect(level).toBeGreaterThan(0.98);
    expect(level).toBeLessThan(1.02);
  });

  describe('on voices that are not perfectly periodic', () => {
    // A perfectly periodic test tone hides a missing cross-fade (any two periods are the same
    // waveform). Real voices drift from period to period, so these inputs do too, and carry
    // no noise that could mask a click. A spliced output may be no more curved than the input
    // transposed by the ratio, i.e. the largest second difference at most ~1.25 × ratio² of
    // the input's; a hard switch between two slightly different periods is several times that.
    const durationSec = 0.7;
    const midiOf = (f0Hz: number) => 69 + 12 * Math.log2(f0Hz / 440);
    const inputs = [
      {
        name: '25 cent cycle-to-cycle jitter at 110 Hz',
        midiAt: () => midiOf(110),
        signal: synthesizeVoice({
          sampleRate: SAMPLE_RATE,
          durationSec,
          midi: midiOf(110),
          jitterCents: 25,
        }),
      },
      {
        name: '2 Hz ±2 semitone glide around 220 Hz',
        midiAt: (timeSec: number) => midiOf(220) + 2 * Math.sin(2 * Math.PI * 2 * timeSec),
        signal: synthesizeVoice({
          sampleRate: SAMPLE_RATE,
          durationSec,
          midi: (timeSec) => midiOf(220) + 2 * Math.sin(2 * Math.PI * 2 * timeSec),
        }),
      },
      {
        name: '23 Hz amplitude modulation at 165 Hz',
        midiAt: () => midiOf(165),
        signal: synthesizeVoice({ sampleRate: SAMPLE_RATE, durationSec, midi: midiOf(165) }).map(
          (sample, n) => sample * (0.6 + 0.4 * Math.sin((2 * Math.PI * 23 * n) / SAMPLE_RATE)),
        ),
      },
    ];

    for (const { name, midiAt, signal } of inputs) {
      it(`splices without clicks: ${name}`, () => {
        for (const semitones of [-1, 1, 3]) {
          const ratio = semitonesToRatio(semitones);
          const shifter = new PitchShifter({ sampleRate: SAMPLE_RATE });
          const output = Float32Array.from(signal);
          const ratios = new Float32Array(BLOCK).fill(ratio);
          for (let offset = 0; offset < signal.length; offset += BLOCK) {
            // The period as a detector would report it, once per block.
            shifter.setPeriod(SAMPLE_RATE / midiToHz(midiAt(offset / SAMPLE_RATE)));
            shifter.process(output, offset, Math.min(BLOCK, signal.length - offset), ratios);
          }
          const label = `${semitones} st`;
          expect(shifter.spliceCount, label).toBeGreaterThan(2);
          const curvature =
            maxSecondDifference(output, FROM, FROM + LENGTH) /
            maxSecondDifference(signal, FROM - 2400, FROM + LENGTH);
          expect(curvature, label).toBeLessThan(1.25 * ratio * ratio);
        }
      });
    }
  });

  it('needs no splices at all for a correction that averages out (pure vibrato removal)', () => {
    const input = voiceAt(220);
    const ratioAt = (n: number) =>
      semitonesToRatio(0.6 * Math.sin((2 * Math.PI * 6 * n) / SAMPLE_RATE));
    const { shifter, minDelay, maxDelay } = shift(input, ratioAt, SAMPLE_RATE / 220);
    expect(shifter.spliceCount).toBe(0);
    expect(maxDelay - minDelay).toBeLessThan(120);
  });
});

describe('PitchShifter latency', () => {
  it('keeps the delay within one period of the nominal 5 ms for typical voices', () => {
    for (const f0Hz of [155, 220, 330, 466, 800]) {
      const periodMs = 1000 / f0Hz;
      for (const semitones of [-3, 3]) {
        const result = shift(voiceAt(f0Hz), () => semitonesToRatio(semitones), SAMPLE_RATE / f0Hz);
        const minMs = (result.minDelay / SAMPLE_RATE) * 1000;
        const maxMs = (result.maxDelay / SAMPLE_RATE) * 1000;
        expect(minMs, `${f0Hz} Hz`).toBeGreaterThan(0.5);
        expect(maxMs, `${f0Hz} Hz`).toBeLessThan(5 + periodMs);
        expect(maxMs, `${f0Hz} Hz`).toBeLessThan(10);
      }
    }
  });

  it('keeps the mean delay near 5 ms while correcting, and under 1.5 ms + 0.8 periods for low voices', () => {
    for (const f0Hz of [98, 110, 131, 165, 220, 330]) {
      const periodMs = 1000 / f0Hz;
      for (const semitones of [-1, 1, -3, 3]) {
        const input = voiceAt(f0Hz);
        const shifter = new PitchShifter({ sampleRate: SAMPLE_RATE, maxShiftSemitones: 4 });
        shifter.setPeriod(SAMPLE_RATE / f0Hz);
        const output = Float32Array.from(input);
        const ratios = new Float32Array(BLOCK).fill(semitonesToRatio(semitones));
        let sum = 0;
        let count = 0;
        for (let offset = 0; offset + BLOCK <= input.length; offset += BLOCK) {
          shifter.process(output, offset, BLOCK, ratios);
          if (offset < FROM) continue;
          sum += shifter.delaySamples;
          count++;
        }
        const meanMs = (1000 * sum) / count / SAMPLE_RATE;
        const label = `${f0Hz} Hz, ${semitones} st`;
        expect(meanMs, label).toBeLessThan(Math.max(6, 1.5 + 0.8 * periodMs));
        expect(meanMs, label).toBeGreaterThan(3);
      }
    }
  });

  it('returns toward the nominal delay once the ratio is back to 1, and exactly to it without a pitch', () => {
    for (const f0Hz of [98, 110, 131, 220]) {
      const period = SAMPLE_RATE / f0Hz;
      const input = synthesizeVoice({
        sampleRate: SAMPLE_RATE,
        durationSec: 0.9,
        midi: 69 + 12 * Math.log2(f0Hz / 440),
        jitterCents: 3,
      });
      const shifter = new PitchShifter({ sampleRate: SAMPLE_RATE, maxShiftSemitones: 4 });
      shifter.setPeriod(period);
      const output = Float32Array.from(input);
      const stopAt = Math.round(0.3 * SAMPLE_RATE);
      const unvoicedAt = Math.round(0.6 * SAMPLE_RATE);
      const ratios = new Float32Array(BLOCK);
      let delayBeforeUnvoiced = 0;
      for (let offset = 0; offset < input.length; offset += BLOCK) {
        const frames = Math.min(BLOCK, input.length - offset);
        // Shift down by 1.4 semitones (the delay grows), then stop.
        ratios.fill(offset < stopAt ? semitonesToRatio(-1.4) : 1);
        if (offset === unvoicedAt) {
          delayBeforeUnvoiced = shifter.delaySamples;
          shifter.clearPeriod();
        }
        shifter.process(output, offset, frames, ratios);
      }
      const label = `${f0Hz} Hz`;
      const latency = shifter.latencySamples;
      // While the voice is pitched: within 0.6 periods, and a bit-exact delayed copy again.
      expect(Math.abs(delayBeforeUnvoiced - latency), label).toBeLessThanOrEqual(0.6 * period);
      expect(Number.isInteger(delayBeforeUnvoiced), label).toBe(true);
      const differs = firstDelayedDifference(
        output,
        input,
        delayBeforeUnvoiced,
        stopAt + 0.15 * SAMPLE_RATE,
      );
      expect(differs === -1 || differs > unvoicedAt, label).toBe(true);
      // Told there is no pitch: exactly the nominal delay after one cross-fade.
      expect(shifter.delaySamples, label).toBe(latency);
      expect(firstDelayedDifference(output, input, latency, unvoicedAt + 0.01 * SAMPLE_RATE)).toBe(
        -1,
      );
    }
  });

  it('never exceeds 25 ms even for the lowest voices at the largest shift', () => {
    for (const semitones of [-4, 4]) {
      const voice = synthesizeVoice({ sampleRate: SAMPLE_RATE, durationSec: 0.7, midi: 38 });
      const result = shift(voice, () => semitonesToRatio(semitones), SAMPLE_RATE / midiToHz(38));
      expect(result.minDelay).toBeGreaterThanOrEqual(2);
      expect(result.maxDelay / SAMPLE_RATE).toBeLessThan(0.025);
    }
  });
});

describe('PitchShifter block handling', () => {
  it('gives identical output for any block size and honours the offset', () => {
    const input = voiceAt(220);
    const ratioAt = (n: number) =>
      semitonesToRatio(0.8 + 0.5 * Math.sin((2 * Math.PI * 5 * n) / SAMPLE_RATE));
    const reference = shift(input, ratioAt, SAMPLE_RATE / 220).output;
    expect(firstDifference(reference, input)).toBeGreaterThanOrEqual(0);

    for (const blockSize of [1, 17, 128, 1000, input.length]) {
      const shifter = new PitchShifter({ sampleRate: SAMPLE_RATE });
      shifter.setPeriod(SAMPLE_RATE / 220);
      const output = Float32Array.from(input);
      const ratios = new Float32Array(blockSize);
      for (let offset = 0; offset < input.length; offset += blockSize) {
        const frames = Math.min(blockSize, input.length - offset);
        for (let i = 0; i < frames; i++) ratios[i] = ratioAt(offset + i);
        shifter.process(output, offset, frames, ratios);
      }
      expect(firstDifference(output, reference), `block size ${blockSize}`).toBe(-1);
    }
  });

  it('touches only the requested part of the buffer', () => {
    const buffer = new Float32Array(300).fill(0.25);
    const shifter = new PitchShifter({ sampleRate: SAMPLE_RATE });
    shifter.process(buffer, 100, 50, new Float32Array(50).fill(1));
    expect(buffer.subarray(0, 100).every((sample) => sample === 0.25)).toBe(true);
    expect(buffer.subarray(150).every((sample) => sample === 0.25)).toBe(true);
    // The first 240 output samples are the (empty) contents of the delay line.
    expect(buffer.subarray(100, 150).every((sample) => sample === 0)).toBe(true);
  });
});

describe('PitchShifter robustness', () => {
  it('becomes bit-transparent again shortly after shifting stops', () => {
    const input = voiceAt(220);
    const stopAt = Math.round(0.3 * SAMPLE_RATE);
    const { output, shifter } = shift(
      input,
      (n) => (n < stopAt ? semitonesToRatio(0.7) : 1),
      SAMPLE_RATE / 220,
    );
    const delay = shifter.delaySamples;
    expect(Number.isInteger(delay)).toBe(true);
    const settledFrom = stopAt + Math.round(0.06 * SAMPLE_RATE);
    expect(firstDelayedDifference(output, input, delay, settledFrom)).toBe(-1);
  });

  it('clamps unusable ratios instead of failing', () => {
    const input = voiceAt(330);
    const garbage = [Number.NaN, 0, -3, 100, Infinity, -Infinity];
    const { output, minDelay, maxDelay } = shift(
      input,
      (n) => garbage[Math.floor(n / 2000) % garbage.length]!,
      SAMPLE_RATE / 330,
    );
    expect(output.every((sample) => Number.isFinite(sample))).toBe(true);
    expect(minDelay).toBeGreaterThanOrEqual(2);
    expect(maxDelay / SAMPLE_RATE).toBeLessThan(0.03);
    expect(rms(output, FROM, FROM + LENGTH)).toBeGreaterThan(0.5 * rms(input, FROM, FROM + LENGTH));
  });

  it('ignores periods that are not positive numbers and clamps extreme ones', () => {
    const shifter = new PitchShifter({ sampleRate: SAMPLE_RATE });
    for (const period of [Number.NaN, 0, -100, 1, 1e9, Infinity]) shifter.setPeriod(period);
    const output = Float32Array.from(voiceAt(220));
    shifter.process(output, 0, output.length, new Float32Array(output.length).fill(1.1));
    expect(output.every((sample) => Number.isFinite(sample))).toBe(true);
    expect(shifter.delaySamples / SAMPLE_RATE).toBeLessThan(0.03);
  });

  it('shifts noise without changing its level much', () => {
    const noise = whiteNoise(SAMPLE_RATE, 0.7, 0.1, 9);
    const { output } = shift(noise, () => semitonesToRatio(2), null);
    expect(output.every((sample) => Number.isFinite(sample))).toBe(true);
    const ratio = rms(output, FROM, FROM + LENGTH) / rms(noise, FROM, FROM + LENGTH);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.1);
  });

  it('returns to its initial state on reset', () => {
    const input = voiceAt(220);
    const shifter = new PitchShifter({ sampleRate: SAMPLE_RATE });
    const ratios = new Float32Array(input.length).fill(1.08);
    const run = (): Float32Array => {
      shifter.setPeriod(SAMPLE_RATE / 220);
      const output = Float32Array.from(input);
      shifter.process(output, 0, output.length, ratios);
      return output;
    };
    const first = run();
    shifter.reset();
    expect(shifter.spliceCount).toBe(0);
    expect(shifter.delaySamples).toBe(shifter.latencySamples);
    expect(firstDifference(run(), first)).toBe(-1);
  });
});
