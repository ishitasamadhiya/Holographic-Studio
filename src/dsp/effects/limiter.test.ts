import { describe, expect, it } from 'vitest';
import { firstDifference, peak } from '../testing/measure';
import { whiteNoise } from '../testing/syntheticVoice';
import { LIMITER_CEILING, LIMITER_THRESHOLD, LimiterUnit } from './limiter';

const SAMPLE_RATE = 48000;

function sine(amplitude: number, seconds: number, frequencyHz = 220): Float32Array {
  const signal = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let n = 0; n < signal.length; n++) {
    signal[n] = amplitude * Math.sin((2 * Math.PI * frequencyHz * n) / SAMPLE_RATE);
  }
  return signal;
}

function limit(
  left: Float32Array,
  right: Float32Array = left,
): { left: Float32Array; right: Float32Array } {
  const unit = new LimiterUnit(SAMPLE_RATE);
  const outLeft = Float32Array.from(left);
  const outRight = Float32Array.from(right);
  for (let offset = 0; offset < left.length; offset += 128) {
    const frames = Math.min(128, left.length - offset);
    unit.process(
      outLeft.subarray(offset, offset + frames),
      outRight.subarray(offset, offset + frames),
      frames,
    );
  }
  return { left: outLeft, right: outRight };
}

describe('LimiterUnit', () => {
  it('turns NaN and infinite samples into silence and keeps limiting afterwards', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      const left = sine(2, 0.5);
      const right = sine(2, 0.5);
      left[3] = bad;
      right[700] = bad;
      const out = limit(left, right);
      expect(out.left[3]).toBe(0);
      expect(out.right[700]).toBe(0);
      expect(out.left.every((sample) => Number.isFinite(sample))).toBe(true);
      expect(out.right.every((sample) => Number.isFinite(sample))).toBe(true);
      // A 2.0 sine is still brought under the ceiling everywhere after the bad samples.
      expect(peak(out.left, 4)).toBeLessThanOrEqual(LIMITER_CEILING);
      expect(peak(out.right, 701)).toBeLessThanOrEqual(LIMITER_CEILING);
      expect(peak(out.left, 4)).toBeGreaterThan(0.9);
    }
  });

  it('has its knee at -3 dBFS and its ceiling just under full scale', () => {
    expect(20 * Math.log10(LIMITER_THRESHOLD)).toBeCloseTo(-3, 6);
    expect(LIMITER_CEILING).toBeLessThan(1);
    expect(LIMITER_CEILING).toBeGreaterThan(0.95);
  });

  it('is exactly transparent below -3 dBFS', () => {
    for (const amplitude of [0.01, 0.3, 0.7]) {
      const input = sine(amplitude, 0.5);
      expect(firstDifference(limit(input).left, input)).toBe(-1);
    }
    const noise = whiteNoise(SAMPLE_RATE, 0.5, 0.1, 4).map((s) => Math.max(-0.7, Math.min(0.7, s)));
    expect(firstDifference(limit(noise).left, noise)).toBe(-1);
  });

  it('never lets the output exceed the ceiling, whatever comes in', () => {
    const hot: Float32Array[] = [
      sine(1, 0.5),
      sine(2.5, 0.5),
      sine(8, 0.5, 55),
      sine(8, 0.5, 9000),
      whiteNoise(SAMPLE_RATE, 1, 3, 9),
      new Float32Array(4800).fill(8),
      new Float32Array(4800).map((_, n) => (n % 1000 === 0 ? -8 : 0.001)),
    ];
    for (const input of hot) {
      const { left, right } = limit(
        input,
        input.map((sample) => -0.5 * sample),
      );
      // (Output samples are 32-bit floats, so the ceiling is compared at that precision.)
      expect(peak(left)).toBeLessThanOrEqual(Math.fround(LIMITER_CEILING));
      expect(peak(right)).toBeLessThanOrEqual(Math.fround(LIMITER_CEILING));
      expect(peak(left)).toBeLessThan(1);
      expect(peak(left)).toBeGreaterThan(LIMITER_THRESHOLD);
    }
  });

  it('compresses progressively above the knee instead of clipping', () => {
    let previous = 0;
    for (const amplitude of [0.75, 0.9, 1.2, 1.6, 2, 2.5]) {
      const outputPeak = peak(limit(sine(amplitude, 0.3)).left);
      expect(outputPeak).toBeGreaterThan(previous);
      expect(outputPeak).toBeLessThan(amplitude);
      previous = outputPeak;
    }
    // Just above the knee the bend is gentle: 1 dB over the threshold loses under 0.2 dB.
    const justOver = LIMITER_THRESHOLD * 10 ** (1 / 20);
    const loss = 20 * Math.log10(peak(limit(sine(justOver, 0.3)).left) / justOver);
    expect(loss).toBeLessThan(0);
    expect(loss).toBeGreaterThan(-0.2);
    // A sustained loud tone keeps its shape: gain reduction, not waveshaping.
    const loud = limit(sine(3, 0.5)).left;
    const from = Math.round(0.3 * SAMPLE_RATE);
    let correlation = 0;
    let power = 0;
    let reference = 0;
    const input = sine(3, 0.5);
    for (let n = from; n < loud.length; n++) {
      correlation += loud[n]! * input[n]!;
      power += loud[n]! * loud[n]!;
      reference += input[n]! * input[n]!;
    }
    expect(correlation / Math.sqrt(power * reference)).toBeGreaterThan(0.999);
  });

  it('links the channels so the stereo image does not shift', () => {
    const loud = sine(3, 0.3);
    const quiet = sine(0.3, 0.3, 330);
    const { left, right } = limit(loud, quiet);
    for (let n = 1000; n < loud.length; n += 97) {
      const gainLeft = left[n]! / loud[n]!;
      const gainRight = right[n]! / quiet[n]!;
      if (Math.abs(loud[n]!) > 0.01 && Math.abs(quiet[n]!) > 0.01) {
        expect(gainRight).toBeCloseTo(gainLeft, 5);
      }
    }
  });

  it('recovers after a peak and becomes transparent again', () => {
    const input = new Float32Array(SAMPLE_RATE);
    input.set(sine(4, 0.1));
    input.set(sine(0.3, 0.9), Math.round(0.1 * SAMPLE_RATE));
    const { left } = limit(input);
    const shortlyAfter = Math.round(0.11 * SAMPLE_RATE);
    expect(Math.abs(left[shortlyAfter + 55]!)).toBeLessThan(Math.abs(input[shortlyAfter + 55]!));
    const recovered = Math.round(0.6 * SAMPLE_RATE);
    expect(firstDifference(left.subarray(recovered), input.subarray(recovered))).toBe(-1);
  });

  it('adds no latency and forgets its gain reduction on reset', () => {
    const unit = new LimiterUnit(SAMPLE_RATE);
    expect(unit.latencySamples).toBe(0);
    const loud = sine(4, 0.1);
    unit.process(Float32Array.from(loud), Float32Array.from(loud), loud.length);
    unit.reset();
    const quiet = sine(0.3, 0.1);
    const out = Float32Array.from(quiet);
    unit.process(out, Float32Array.from(quiet), out.length);
    expect(firstDifference(out, quiet)).toBe(-1);
  });
});
