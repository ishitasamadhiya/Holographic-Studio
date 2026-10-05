import { describe, expect, it } from 'vitest';
import { firstDifference, maxStep, peak, rms } from '../testing/measure';
import { createRandom } from '../testing/random';
import { synthesizeVoice, whiteNoise } from '../testing/syntheticVoice';
import { ReverbUnit } from './reverb';

const SAMPLE_RATE = 48000;

interface Stereo {
  left: Float32Array;
  right: Float32Array;
}

function run(
  input: Float32Array,
  enabledAt: boolean | ((timeSec: number) => boolean),
  unit = new ReverbUnit(SAMPLE_RATE),
  blockSizeAt: (offset: number) => number = () => 128,
): Stereo {
  const left = Float32Array.from(input);
  const right = Float32Array.from(input);
  for (let offset = 0; offset < input.length;) {
    const frames = Math.min(blockSizeAt(offset), input.length - offset);
    unit.setEnabled(typeof enabledAt === 'boolean' ? enabledAt : enabledAt(offset / SAMPLE_RATE));
    unit.process(
      left.subarray(offset, offset + frames),
      right.subarray(offset, offset + frames),
      frames,
    );
    offset += frames;
  }
  return { left, right };
}

function difference(a: Float32Array, b: Float32Array): Float32Array {
  return a.map((sample, n) => sample - b[n]!);
}

describe('ReverbUnit when off', () => {
  it('is exactly transparent and adds no latency', () => {
    const voice = synthesizeVoice({ sampleRate: SAMPLE_RATE, durationSec: 1, midi: 60 });
    const { left, right } = run(voice, false);
    expect(firstDifference(left, voice)).toBe(-1);
    expect(firstDifference(right, voice)).toBe(-1);
    expect(new ReverbUnit(SAMPLE_RATE).latencySamples).toBe(0);
  });
});

describe('ReverbUnit when on', () => {
  it('leaves the dry signal in place and adds a light tail under it', () => {
    const noise = whiteNoise(SAMPLE_RATE, 4, 0.1, 12);
    const { left, right } = run(noise, true);
    const from = 2 * SAMPLE_RATE;
    for (const channel of [left, right]) {
      const wetDb = 20 * Math.log10(rms(difference(channel, noise), from) / rms(noise, from));
      expect(wetDb).toBeGreaterThan(-20);
      expect(wetDb).toBeLessThan(-10);
    }
  });

  it('rings out after the sound stops, for about a second', () => {
    const input = new Float32Array(5 * SAMPLE_RATE);
    input.set(whiteNoise(SAMPLE_RATE, 0.5, 0.2, 5));
    const { left } = run(input, true);
    const levelDb = (fromSec: number) =>
      20 * Math.log10(rms(left, fromSec * SAMPLE_RATE, (fromSec + 0.1) * SAMPLE_RATE));
    const start = levelDb(0.52);
    expect(start).toBeGreaterThan(-45);
    // Decay time to -60 dB between 0.6 s and 2.5 s: clearly a tail, clearly not a cathedral.
    expect(levelDb(1.1)).toBeLessThan(start - 12);
    expect(levelDb(1.1)).toBeGreaterThan(start - 60);
    expect(levelDb(3.0)).toBeLessThan(start - 60);
    // Monotonic decay in half-second steps.
    for (let sec = 1; sec <= 3; sec += 0.5) expect(levelDb(sec)).toBeLessThan(levelDb(sec - 0.5));
  });

  it('is stereo: the two channels carry different reflections', () => {
    const input = new Float32Array(SAMPLE_RATE);
    input.set(whiteNoise(SAMPLE_RATE, 0.2, 0.2, 5));
    const { left, right } = run(input, true);
    const from = Math.round(0.3 * SAMPLE_RATE);
    let cross = 0;
    let powerLeft = 0;
    let powerRight = 0;
    for (let n = from; n < input.length; n++) {
      cross += left[n]! * right[n]!;
      powerLeft += left[n]! * left[n]!;
      powerRight += right[n]! * right[n]!;
    }
    expect(Math.abs(cross) / Math.sqrt(powerLeft * powerRight)).toBeLessThan(0.6);
    expect(powerLeft / powerRight).toBeGreaterThan(0.5);
    expect(powerLeft / powerRight).toBeLessThan(2);
  });

  it('stays bounded for loud input', () => {
    const loud = whiteNoise(SAMPLE_RATE, 10, 0.5, 31).map((s) => Math.max(-1, Math.min(1, s)));
    const { left, right } = run(loud, true);
    for (const channel of [left, right]) {
      expect(channel.every((sample) => Number.isFinite(sample))).toBe(true);
      expect(peak(channel)).toBeLessThan(2);
      expect(rms(channel, 9 * SAMPLE_RATE)).toBeLessThan(
        1.05 * rms(channel, 4 * SAMPLE_RATE, 5 * SAMPLE_RATE),
      );
    }
  });
});

describe('ReverbUnit toggle', () => {
  // A steady tone: anything the switch adds that is not a smooth 220 Hz wave stands out.
  const toneHz = 220;
  const tone = new Float32Array(5 * SAMPLE_RATE);
  for (let n = 0; n < tone.length; n++) {
    tone[n] = 0.5 * Math.sin((2 * Math.PI * toneHz * n) / SAMPLE_RATE);
  }

  /** Largest second difference: tiny for a smooth low tone, large for any step or click. */
  function roughness(signal: Float32Array, startSec: number, endSec: number): number {
    let largest = 0;
    for (
      let n = Math.round(startSec * SAMPLE_RATE) + 2;
      n < Math.round(endSec * SAMPLE_RATE);
      n++
    ) {
      largest = Math.max(largest, Math.abs(signal[n]! - 2 * signal[n - 1]! + signal[n - 2]!));
    }
    return largest;
  }

  it('switches on and off without a click', () => {
    const { left, right } = run(tone, (timeSec) => timeSec >= 1 && timeSec < 2.5);
    for (const channel of [left, right]) {
      const wet = difference(channel, tone);
      const level = peak(wet);
      expect(level).toBeGreaterThan(0.01);
      // A 220 Hz sine of amplitude A has second differences of at most A·ω². The reverb of
      // the tone stays close to that around both switch moments; an abrupt switch would
      // exceed it tens of times over.
      const smooth = level * ((2 * Math.PI * toneHz) / SAMPLE_RATE) ** 2;
      expect(roughness(wet, 0.99, 1.3)).toBeLessThan(3 * smooth);
      expect(roughness(wet, 2.49, 2.8)).toBeLessThan(3 * smooth);
      // And the complete output is as smooth as the tone itself.
      expect(maxStep(channel)).toBeLessThan(1.25 * maxStep(tone));
    }
  });

  it('builds up gradually when switched on', () => {
    const { left } = run(tone, (timeSec) => timeSec >= 1);
    const wet = difference(left, tone);
    expect(peak(wet, 0, SAMPLE_RATE)).toBe(0);
    expect(rms(wet, SAMPLE_RATE, 1.005 * SAMPLE_RATE)).toBeLessThan(
      0.1 * rms(wet, 3 * SAMPLE_RATE),
    );
  });

  it('lets the tail ring out when switched off, then becomes exactly transparent', () => {
    const { left } = run(tone, (timeSec) => timeSec < 0.5);
    const wet = difference(left, tone);
    const whileOn = rms(wet, 0.3 * SAMPLE_RATE, 0.5 * SAMPLE_RATE);
    expect(rms(wet, 0.6 * SAMPLE_RATE, 0.8 * SAMPLE_RATE)).toBeGreaterThan(0.2 * whileOn);
    expect(rms(wet, 2.5 * SAMPLE_RATE, 2.7 * SAMPLE_RATE)).toBeLessThan(0.02 * whileOn);
    const idleFrom = Math.round(4.3 * SAMPLE_RATE);
    expect(firstDifference(left.subarray(idleFrom), tone.subarray(idleFrom))).toBe(-1);
  });
});

describe('ReverbUnit streaming behaviour', () => {
  // A phrase, a long digital silence (the unit goes idle), then another phrase.
  const input = new Float32Array(9 * SAMPLE_RATE);
  input.set(whiteNoise(SAMPLE_RATE, 1.2, 0.2, 77));
  input.set(whiteNoise(SAMPLE_RATE, 1, 0.2, 78), 6 * SAMPLE_RATE);

  it('gives identical output for odd block sizes, including across switching and idling', () => {
    const enabledAt = (timeSec: number) => timeSec < 7.5 && !(timeSec > 0.6 && timeSec < 0.8);
    // The switch is operated on a 128-frame grid in both runs; only the block sizes differ.
    const enabledAtFrame = (frame: number) =>
      enabledAt((Math.floor(frame / 128) * 128) / SAMPLE_RATE);
    const reference = run(input, (timeSec) => enabledAtFrame(Math.round(timeSec * SAMPLE_RATE)));

    const random = createRandom(5);
    const unit = new ReverbUnit(SAMPLE_RATE);
    const left = Float32Array.from(input);
    const right = Float32Array.from(input);
    for (let offset = 0; offset < input.length;) {
      const untilGrid = 128 - (offset % 128);
      const frames = Math.min(untilGrid, 1 + Math.floor(random() * 200), input.length - offset);
      unit.setEnabled(enabledAtFrame(offset));
      unit.process(
        left.subarray(offset, offset + frames),
        right.subarray(offset, offset + frames),
        frames,
      );
      offset += frames;
    }
    expect(firstDifference(left, reference.left)).toBe(-1);
    expect(firstDifference(right, reference.right)).toBe(-1);
  });

  it('gives identical output for large blocks', () => {
    const reference = run(input, true);
    for (const blockSize of [1000, 4096]) {
      const large = run(input, true, new ReverbUnit(SAMPLE_RATE), () => blockSize);
      expect(firstDifference(large.left, reference.left)).toBe(-1);
      expect(firstDifference(large.right, reference.right)).toBe(-1);
    }
    // The silence really did put the unit to sleep: by then the output is exactly the input.
    const asleep = Math.round(5 * SAMPLE_RATE);
    const awake = Math.round(5.9 * SAMPLE_RATE);
    expect(peak(reference.left, asleep, awake)).toBe(0);
    expect(peak(reference.left, 1.3 * SAMPLE_RATE, 2 * SAMPLE_RATE)).toBeGreaterThan(0);
  });

  it('is silent again after reset', () => {
    const unit = new ReverbUnit(SAMPLE_RATE);
    run(whiteNoise(SAMPLE_RATE, 1, 0.3, 3), true, unit);
    unit.reset();
    const { left, right } = run(new Float32Array(SAMPLE_RATE), true, unit);
    expect(peak(left)).toBe(0);
    expect(peak(right)).toBe(0);
  });
});
