import { describe, expect, it } from 'vitest';
import { PeakHold } from './peakHold';

const options = { holdMs: 1000, decayPerSecond: 0.5 };

describe('PeakHold', () => {
  it('follows a rising level immediately', () => {
    const peak = new PeakHold(options);
    expect(peak.update(0.2, 0)).toBe(0.2);
    expect(peak.update(0.7, 16)).toBe(0.7);
  });

  it('holds the peak while the level drops, until the hold time is over', () => {
    const peak = new PeakHold(options);
    peak.update(0.8, 0);
    expect(peak.update(0.1, 500)).toBe(0.8);
    expect(peak.update(0.1, 1000)).toBe(0.8);
  });

  it('falls at the configured rate once the hold time is over', () => {
    const peak = new PeakHold(options);
    peak.update(0.8, 0);
    peak.update(0.1, 1000);
    // 200 ms after the hold ended at 0.5/s → 0.1 lower.
    expect(peak.update(0.1, 1200)).toBeCloseTo(0.7, 10);
    expect(peak.update(0.1, 1600)).toBeCloseTo(0.5, 10);
  });

  it('counts the fall from the end of the hold even when updates were sparse', () => {
    const peak = new PeakHold(options);
    peak.update(0.8, 0);
    // No update between 0 and 1400 ms: only the 400 ms after the hold may count.
    expect(peak.update(0, 1400)).toBeCloseTo(0.6, 10);
  });

  it('never falls below the current level', () => {
    const peak = new PeakHold(options);
    peak.update(0.8, 0);
    expect(peak.update(0.3, 10_000)).toBe(0.3);
  });

  it('restarts the hold when a new, higher peak arrives', () => {
    const peak = new PeakHold(options);
    peak.update(0.5, 0);
    peak.update(0.9, 900);
    // Still inside the second peak's hold window, although the first one has expired.
    expect(peak.update(0.1, 1800)).toBe(0.9);
    expect(peak.update(0.1, 2100)).toBeCloseTo(0.8, 10);
  });

  it('forgets everything on reset', () => {
    const peak = new PeakHold(options);
    peak.update(0.9, 0);
    peak.reset();
    expect(peak.update(0.1, 10)).toBe(0.1);
  });
});
