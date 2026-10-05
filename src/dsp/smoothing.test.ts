import { describe, expect, it } from 'vitest';
import { OnePoleSmoother, smoothingCoefficient } from './smoothing';

const SAMPLE_RATE = 48000;

/** Advances a smoother by `count` samples and returns every value it passed through. */
function advance(smoother: OnePoleSmoother, count: number): Float32Array {
  const values = new Float32Array(count);
  smoother.fill(values, count);
  return values;
}

describe('smoothingCoefficient', () => {
  it('covers 63% of a step in one time constant', () => {
    const timeConstantSec = 0.02;
    const smoother = new OnePoleSmoother(0, timeConstantSec, SAMPLE_RATE);
    smoother.setTarget(1);
    advance(smoother, timeConstantSec * SAMPLE_RATE);
    expect(smoother.value).toBeCloseTo(1 - 1 / Math.E, 3);
  });

  it('means "no smoothing" for a zero or invalid time constant', () => {
    expect(smoothingCoefficient(0, SAMPLE_RATE)).toBe(1);
    expect(smoothingCoefficient(-1, SAMPLE_RATE)).toBe(1);
    expect(smoothingCoefficient(Number.NaN, SAMPLE_RATE)).toBe(1);
  });
});

describe('OnePoleSmoother', () => {
  it('glides without steps larger than its coefficient allows (no zipper noise)', () => {
    const smoother = new OnePoleSmoother(0.2, 0.02, SAMPLE_RATE);
    smoother.setTarget(1.8);
    const largestAllowedStep = smoothingCoefficient(0.02, SAMPLE_RATE) * 1.6;
    const values = advance(smoother, SAMPLE_RATE / 2);
    let previous = 0.2;
    let largestStep = 0;
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(Math.fround(previous));
      largestStep = Math.max(largestStep, value - previous);
      previous = value;
    }
    // (The values are read back from a 32-bit buffer, hence the small allowance.)
    expect(largestStep).toBeLessThanOrEqual(largestAllowedStep + 1e-6);
    expect(largestStep).toBeLessThan(0.002);
  });

  it('lands exactly on the target and then stays there', () => {
    const smoother = new OnePoleSmoother(0.3, 0.01, SAMPLE_RATE);
    smoother.setTarget(1);
    advance(smoother, SAMPLE_RATE);
    expect(smoother.value).toBe(1);
    expect(smoother.isSettled).toBe(true);
    expect(Array.from(advance(smoother, 3))).toEqual([1, 1, 1]);
  });

  it('follows a moving target in both directions', () => {
    const smoother = new OnePoleSmoother(0, 0.005, SAMPLE_RATE);
    smoother.setTarget(1);
    advance(smoother, 4800);
    expect(smoother.value).toBeGreaterThan(0.99);
    smoother.setTarget(-1);
    advance(smoother, 4800);
    expect(smoother.value).toBeLessThan(-0.99);
  });

  it('continues seamlessly from one block to the next', () => {
    const whole = new OnePoleSmoother(0.2, 0.01, SAMPLE_RATE);
    const pieces = new OnePoleSmoother(0.2, 0.01, SAMPLE_RATE);
    whole.setTarget(1);
    pieces.setTarget(1);
    const reference = advance(whole, 5000);
    const joined = new Float32Array(5000);
    for (let offset = 0; offset < joined.length;) {
      const count = Math.min(1 + ((offset * 13) % 97), joined.length - offset);
      joined.set(advance(pieces, count), offset);
      offset += count;
    }
    expect(Array.from(joined)).toEqual(Array.from(reference));
    expect(pieces.value).toBe(whole.value);
  });

  it('ignores targets that are not finite numbers', () => {
    const smoother = new OnePoleSmoother(0.5, 0.01, SAMPLE_RATE);
    smoother.setTarget(Number.NaN);
    smoother.setTarget(Infinity);
    expect(smoother.targetValue).toBe(0.5);
    expect(Array.from(advance(smoother, 2))).toEqual([0.5, 0.5]);
  });

  it('can be snapped to a value', () => {
    const smoother = new OnePoleSmoother(0, 1, SAMPLE_RATE);
    smoother.setTarget(1);
    advance(smoother, 100);
    smoother.snapTo(0.75);
    expect(smoother.value).toBe(0.75);
    expect(smoother.targetValue).toBe(0.75);
    expect(smoother.isSettled).toBe(true);
  });

  it('jumps straight to the target when built without a time constant', () => {
    const smoother = new OnePoleSmoother(0, 0, SAMPLE_RATE);
    smoother.setTarget(0.125);
    expect(advance(smoother, 1)[0]).toBe(0.125);
  });
});
