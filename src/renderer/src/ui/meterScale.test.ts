import { describe, expect, it } from 'vitest';
import { amplitudeToMeterLevel, decibelsToMeterLevel } from './meterScale';

describe('decibelsToMeterLevel', () => {
  it('maps the floor to 0 and full scale to 1', () => {
    expect(decibelsToMeterLevel(-60)).toBe(0);
    expect(decibelsToMeterLevel(0)).toBe(1);
  });

  it('is linear in decibels', () => {
    expect(decibelsToMeterLevel(-30)).toBeCloseTo(0.5, 10);
    expect(decibelsToMeterLevel(-6)).toBeCloseTo(0.9, 10);
    expect(decibelsToMeterLevel(-12, -48)).toBeCloseTo(0.75, 10);
  });

  it('clamps beyond either end and treats NaN and silence as 0', () => {
    expect(decibelsToMeterLevel(-90)).toBe(0);
    expect(decibelsToMeterLevel(6)).toBe(1);
    expect(decibelsToMeterLevel(Number.NaN)).toBe(0);
    expect(decibelsToMeterLevel(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('amplitudeToMeterLevel', () => {
  it('converts linear amplitude through decibels', () => {
    expect(amplitudeToMeterLevel(1)).toBe(1);
    // 0.5 is about -6.02 dBFS.
    expect(amplitudeToMeterLevel(0.5)).toBeCloseTo(1 - 6.0206 / 60, 4);
    expect(amplitudeToMeterLevel(0.001)).toBeCloseTo(0, 10);
  });

  it('returns 0 for silence and invalid input', () => {
    expect(amplitudeToMeterLevel(0)).toBe(0);
    expect(amplitudeToMeterLevel(-0.3)).toBe(0);
    expect(amplitudeToMeterLevel(Number.NaN)).toBe(0);
  });
});
