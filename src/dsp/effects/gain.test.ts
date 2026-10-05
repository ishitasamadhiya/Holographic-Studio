import { describe, expect, it } from 'vitest';
import { firstDifference } from '../testing/measure';
import { whiteNoise } from '../testing/syntheticVoice';
import { GainUnit } from './gain';

const SAMPLE_RATE = 48000;

function apply(unit: GainUnit, input: Float32Array): { left: Float32Array; right: Float32Array } {
  const left = Float32Array.from(input);
  const right = Float32Array.from(input);
  for (let offset = 0; offset < input.length; offset += 128) {
    const frames = Math.min(128, input.length - offset);
    unit.process(
      left.subarray(offset, offset + frames),
      right.subarray(offset, offset + frames),
      frames,
    );
  }
  return { left, right };
}

describe('GainUnit', () => {
  it('is exactly transparent at unity gain', () => {
    const noise = whiteNoise(SAMPLE_RATE, 0.3, 0.2, 2);
    const { left, right } = apply(new GainUnit(SAMPLE_RATE), noise);
    expect(firstDifference(left, noise)).toBe(-1);
    expect(firstDifference(right, noise)).toBe(-1);
  });

  it('glides to a new gain without steps and lands on it exactly', () => {
    const unit = new GainUnit(SAMPLE_RATE);
    unit.setGain(0.25);
    const { left, right } = apply(unit, new Float32Array(SAMPLE_RATE / 2).fill(1));
    let largestStep = 0;
    for (let n = 1; n < left.length; n++) {
      expect(left[n]!).toBeLessThanOrEqual(left[n - 1]!);
      largestStep = Math.max(largestStep, left[n - 1]! - left[n]!);
    }
    expect(left[0]!).toBeGreaterThan(0.99);
    expect(largestStep).toBeLessThan(0.001);
    expect(left[left.length - 1]).toBe(0.25);
    expect(firstDifference(right, left)).toBe(-1);
  });

  it('returns to exact transparency after coming back to unity', () => {
    const unit = new GainUnit(SAMPLE_RATE, 1.7);
    unit.setGain(1);
    apply(unit, new Float32Array(SAMPLE_RATE).fill(1));
    const noise = whiteNoise(SAMPLE_RATE, 0.1, 0.2, 2);
    expect(firstDifference(apply(unit, noise).left, noise)).toBe(-1);
  });

  it('ignores negative and non-numeric gains, and keeps its target through reset', () => {
    const unit = new GainUnit(SAMPLE_RATE);
    unit.setGain(0.5);
    unit.setGain(-1);
    unit.setGain(Number.NaN);
    unit.setGain(Infinity);
    unit.reset();
    const { left } = apply(unit, new Float32Array(64).fill(1));
    expect(left.every((sample) => sample === 0.5)).toBe(true);
    expect(unit.latencySamples).toBe(0);
  });
});
