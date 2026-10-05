import { describe, expect, it } from 'vitest';
import { SCALE_INTERVALS, type ScaleMode } from '@shared/music';
import { estimateKey, melodyPitchClassProfile } from './keyEstimation';

/** A plausible pitch-class distribution for a key: scale notes only, triad notes most. */
function profileFor(tonic: number, mode: ScaleMode): number[] {
  const profile = new Array<number>(12).fill(0);
  SCALE_INTERVALS[mode].forEach((interval, degree) => {
    const weight = degree === 0 ? 5 : degree === 4 ? 4 : degree === 2 ? 3 : 1.5;
    profile[(tonic + interval) % 12] = weight;
  });
  return profile;
}

describe('estimateKey', () => {
  const allKeys = (['major', 'minor'] as const).flatMap((mode) =>
    Array.from({ length: 12 }, (_, tonic) => ({ tonic, mode })),
  );

  it.each(allKeys)('finds tonic $tonic $mode', ({ tonic, mode }) => {
    const key = estimateKey([{ profile: profileFor(tonic, mode), weight: 1 }]);
    expect(key.tonic).toBe(tonic);
    expect(key.mode).toBe(mode);
    expect(key.confidence).toBeGreaterThan(0.5);
  });

  it('has no confidence in a flat or empty profile', () => {
    const flat = estimateKey([{ profile: new Array<number>(12).fill(1), weight: 1 }]);
    expect(flat.confidence).toBe(0);
    const empty = estimateKey([{ profile: new Array<number>(12).fill(0), weight: 1 }]);
    expect(empty.confidence).toBe(0);
    expect(Number.isInteger(empty.tonic)).toBe(true);
  });

  it('has little confidence in a chromatic cluster', () => {
    const profile = [3, 2.5, 3, 2.6, 2.9, 3.1, 2.7, 3, 2.8, 2.9, 3.1, 2.6];
    expect(estimateKey([{ profile, weight: 1 }]).confidence).toBeLessThan(0.1);
  });

  it('is not penalised for the relative key, which has the same notes', () => {
    // Equal weight on all seven notes of C major / A minor: the mode is a toss-up, but
    // the scale is not, and that is what the confidence is about.
    const profile = new Array<number>(12).fill(0);
    for (const interval of SCALE_INTERVALS.major) profile[interval] = 1;
    const key = estimateKey([{ profile, weight: 1 }]);
    const notes = new Set(SCALE_INTERVALS[key.mode].map((interval) => (key.tonic + interval) % 12));
    expect([...notes].sort()).toEqual([...SCALE_INTERVALS.major].sort());
  });

  it('combines sources according to their weights, independent of their scale', () => {
    const dMajor = profileFor(2, 'major');
    const aFlatMinor = profileFor(8, 'minor').map((value) => value * 1000);
    expect(
      estimateKey([
        { profile: dMajor, weight: 1 },
        { profile: aFlatMinor, weight: 0 },
      ]).tonic,
    ).toBe(2);
    const outvoted = estimateKey([
      { profile: dMajor, weight: 0.2 },
      { profile: aFlatMinor, weight: 1 },
    ]);
    expect(outvoted.tonic).toBe(8);
    expect(outvoted.mode).toBe('minor');
  });
});

describe('melodyPitchClassProfile', () => {
  it('weights pitch classes by sung duration', () => {
    const profile = melodyPitchClassProfile([
      { startSec: 0, endSec: 2, midi: 60, confidence: 1 },
      { startSec: 2, endSec: 2.5, midi: 72, confidence: 1 },
      { startSec: 3, endSec: 4, midi: 67, confidence: 1 },
    ]);
    expect(profile[0]).toBeCloseTo(2.5, 9);
    expect(profile[7]).toBeCloseTo(1, 9);
    expect(profile.reduce((sum, value) => sum + value, 0)).toBeCloseTo(3.5, 9);
  });
});
