import { describe, expect, it } from 'vitest';
import {
  clamp,
  decibelsToGain,
  flushDenormal,
  nextPowerOfTwo,
  parabolicPeakOffset,
  parabolicPeakValue,
  semitonesToRatio,
} from './math';

describe('flushDenormal', () => {
  it('turns vanishingly small values into exactly zero and leaves the rest alone', () => {
    expect(flushDenormal(1e-30)).toBe(0);
    expect(flushDenormal(-1e-30)).toBe(0);
    expect(flushDenormal(4.9e-324)).toBe(0);
    expect(flushDenormal(1e-10)).toBe(1e-10);
    expect(flushDenormal(-0.5)).toBe(-0.5);
  });
});

describe('parabolic peak interpolation', () => {
  it('finds the vertex of a sampled parabola exactly', () => {
    const vertex = 0.31;
    const parabola = (x: number) => 2 - 0.8 * (x - vertex) * (x - vertex);
    const offset = parabolicPeakOffset(parabola(-1), parabola(0), parabola(1));
    expect(offset).toBeCloseTo(vertex, 12);
    expect(parabolicPeakValue(parabola(-1), parabola(0), parabola(1), offset)).toBeCloseTo(2, 12);
  });

  it('returns no offset when the centre is not a maximum', () => {
    expect(parabolicPeakOffset(1, 0, 1)).toBe(0);
    expect(parabolicPeakOffset(0.5, 0.5, 0.5)).toBe(0);
  });

  it('never points more than half a sample away', () => {
    // Concave, but still rising at the right edge: the true vertex is 1.5 samples away.
    expect(parabolicPeakOffset(0, 1, 1.5)).toBe(0.5);
    expect(parabolicPeakOffset(1.5, 1, 0)).toBe(-0.5);
  });
});

describe('unit conversions', () => {
  it('converts semitones to ratios and decibels to gains', () => {
    expect(semitonesToRatio(12)).toBeCloseTo(2, 12);
    expect(semitonesToRatio(0)).toBe(1);
    expect(semitonesToRatio(-12)).toBeCloseTo(0.5, 12);
    expect(decibelsToGain(-6)).toBeCloseTo(0.5012, 4);
    expect(decibelsToGain(0)).toBe(1);
  });

  it('clamps and rounds up to powers of two', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(1000)).toBe(1024);
    expect(nextPowerOfTwo(1024)).toBe(1024);
    expect(nextPowerOfTwo(1025)).toBe(2048);
  });
});
