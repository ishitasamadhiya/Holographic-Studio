import { describe, expect, it } from 'vitest';
import {
  clamp01,
  VOCAL_VOLUME_MAX_DB,
  VOCAL_VOLUME_MIN_DB,
  VOCAL_VOLUME_UNITY,
  vocalVolumeToDb,
  vocalVolumeToGain,
} from './controls';

describe('vocal volume mapping', () => {
  it('maps the bottom of the range to -12 dB', () => {
    expect(vocalVolumeToDb(0)).toBe(-12);
    expect(VOCAL_VOLUME_MIN_DB).toBe(-12);
    expect(vocalVolumeToGain(0)).toBeCloseTo(10 ** (-12 / 20), 12);
  });

  it('is exactly unity at the midpoint', () => {
    expect(VOCAL_VOLUME_UNITY).toBe(0.5);
    // Math.abs: the lower segment produces -0 here, which is still exactly zero decibels.
    expect(Math.abs(vocalVolumeToDb(0.5))).toBe(0);
    expect(vocalVolumeToGain(0.5)).toBe(1);
  });

  it('maps the top of the range to +5 dB', () => {
    expect(vocalVolumeToDb(1)).toBe(5);
    expect(VOCAL_VOLUME_MAX_DB).toBe(5);
    expect(vocalVolumeToGain(1)).toBeCloseTo(10 ** (5 / 20), 12);
  });

  it('is piecewise linear in decibels on each side of unity', () => {
    expect(vocalVolumeToDb(0.25)).toBeCloseTo(-6, 12);
    expect(vocalVolumeToDb(0.75)).toBeCloseTo(2.5, 12);
  });

  it('rises strictly monotonically over the whole range', () => {
    let previousDb = vocalVolumeToDb(0);
    let previousGain = vocalVolumeToGain(0);
    for (let step = 1; step <= 1000; step++) {
      const value = step / 1000;
      const db = vocalVolumeToDb(value);
      const gain = vocalVolumeToGain(value);
      expect(db).toBeGreaterThan(previousDb);
      expect(gain).toBeGreaterThan(previousGain);
      previousDb = db;
      previousGain = gain;
    }
  });

  it('clamps values outside 0..1', () => {
    expect(vocalVolumeToDb(-0.3)).toBe(-12);
    expect(vocalVolumeToDb(-Infinity)).toBe(-12);
    expect(vocalVolumeToDb(1.7)).toBe(5);
    expect(vocalVolumeToDb(Infinity)).toBe(5);
    expect(vocalVolumeToGain(-5)).toBe(vocalVolumeToGain(0));
    expect(vocalVolumeToGain(5)).toBe(vocalVolumeToGain(1));
  });
});

describe('clamp01', () => {
  it('limits values to the normalized control range', () => {
    expect(clamp01(-0.1)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1.1)).toBe(1);
  });
});
