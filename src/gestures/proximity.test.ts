import { describe, expect, it } from 'vitest';
import { vocalVolumeToDb, VOCAL_VOLUME_MAX_DB, VOCAL_VOLUME_MIN_DB } from '@shared/controls';
import { measureHandScale } from './handScale';
import {
  DEFAULT_NEUTRAL_HAND_SCALE,
  deriveNeutralHandScale,
  proximityFromScale,
  proximityOnAxis,
  resolveNeutralHandScale,
  scaleToProximityAxis,
} from './proximity';
import { SYNTHETIC_IMAGE_ASPECT, syntheticHand } from './testing/syntheticHand';
import type { GestureFrame, HandState, HandStatus } from './types';

function handState(side: 'left' | 'right', status: HandStatus, scale: number): HandState {
  return { side, status, openness: 0, proximity: 0.5, scale, confidence: 1, landmarks: null };
}

function frameWith(left: HandState, right: HandState, timestampMs = 0): GestureFrame {
  return { timestampMs, left, right };
}

describe('proximity mapping', () => {
  const neutral = 0.2;

  it('is 0.5 at the neutral scale, 1 at twice the size and 0 at half the size', () => {
    expect(proximityFromScale(neutral, neutral)).toBeCloseTo(0.5, 12);
    expect(proximityFromScale(neutral * 2, neutral)).toBeCloseTo(1, 12);
    expect(proximityFromScale(neutral / 2, neutral)).toBeCloseTo(0, 12);
  });

  it('is logarithmic: equal ratios of size are equal steps', () => {
    expect(proximityFromScale(neutral * Math.SQRT2, neutral)).toBeCloseTo(0.75, 12);
    expect(proximityFromScale(neutral / Math.SQRT2, neutral)).toBeCloseTo(0.25, 12);
    const step = proximityFromScale(0.24, neutral) - proximityFromScale(0.2, neutral);
    expect(proximityFromScale(0.288, neutral) - proximityFromScale(0.24, neutral)).toBeCloseTo(
      step,
      12,
    );
  });

  it('clamps beyond the range', () => {
    expect(proximityFromScale(neutral * 5, neutral)).toBe(1);
    expect(proximityFromScale(neutral / 5, neutral)).toBe(0);
  });

  it('uses the default neutral scale when none is given', () => {
    expect(proximityFromScale(DEFAULT_NEUTRAL_HAND_SCALE)).toBeCloseTo(0.5, 12);
    expect(resolveNeutralHandScale(null)).toBe(DEFAULT_NEUTRAL_HAND_SCALE);
    expect(resolveNeutralHandScale(undefined)).toBe(DEFAULT_NEUTRAL_HAND_SCALE);
    expect(resolveNeutralHandScale(0)).toBe(DEFAULT_NEUTRAL_HAND_SCALE);
    expect(resolveNeutralHandScale(Number.NaN)).toBe(DEFAULT_NEUTRAL_HAND_SCALE);
    expect(resolveNeutralHandScale(0.27)).toBe(0.27);
  });

  it('agrees with its two-step form used for smoothing', () => {
    for (const scale of [0.09, 0.2, 0.31]) {
      expect(proximityOnAxis(scaleToProximityAxis(scale), neutral)).toBeCloseTo(
        proximityFromScale(scale, neutral),
        12,
      );
    }
  });

  it('follows a measured hand from far to near', () => {
    const proximityAt = (palmScale: number): number => {
      const hand = syntheticHand({ palmScale, closure: 0.4, rollDeg: 15 });
      return proximityFromScale(measureHandScale(hand.landmarks, SYNTHETIC_IMAGE_ASPECT), neutral);
    };
    expect(proximityAt(0.1)).toBeCloseTo(0, 5);
    expect(proximityAt(0.2)).toBeCloseTo(0.5, 5);
    expect(proximityAt(0.4)).toBeCloseTo(1, 5);
    expect(proximityAt(0.3)).toBeGreaterThan(proximityAt(0.25));
  });
});

describe('proximity → vocal volume', () => {
  const neutral = 0.2;
  const volumeDbAt = (scale: number): number => vocalVolumeToDb(proximityFromScale(scale, neutral));

  it('is unity gain at the neutral distance', () => {
    expect(volumeDbAt(neutral)).toBeCloseTo(0, 9);
  });

  it('reaches the loudest setting at half the distance and the quietest at double', () => {
    expect(volumeDbAt(neutral * 2)).toBeCloseTo(VOCAL_VOLUME_MAX_DB, 9);
    expect(volumeDbAt(neutral / 2)).toBeCloseTo(VOCAL_VOLUME_MIN_DB, 9);
    // Coming even closer can never push past the ceiling.
    expect(volumeDbAt(neutral * 4)).toBeCloseTo(VOCAL_VOLUME_MAX_DB, 9);
  });

  it('rises steadily as the hand approaches', () => {
    expect(volumeDbAt(neutral * Math.SQRT2)).toBeCloseTo(VOCAL_VOLUME_MAX_DB / 2, 9);
    expect(volumeDbAt(neutral / Math.SQRT2)).toBeCloseTo(VOCAL_VOLUME_MIN_DB / 2, 9);
    let previous = volumeDbAt(neutral / 2);
    for (let scale = neutral / 2 + 0.01; scale <= neutral * 2; scale += 0.01) {
      const current = volumeDbAt(scale);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });
});

describe('neutral scale calibration', () => {
  const lost = handState('left', 'lost', 0);

  it('takes the median scale of the tracked hand', () => {
    const scales = [
      0.21, 0.2, 0.22, 0.2, 0.21, 0.19, 0.21, 0.2, 0.22, 0.21, 0.2, 0.21, 0.6, 0.21, 0.2, 0.21,
      0.05,
    ];
    const frames = scales.map((scale) => frameWith(lost, handState('right', 'tracking', scale)));
    // The two wild samples (0.6 and 0.05) do not pull the result.
    expect(deriveNeutralHandScale(frames)).toBe(0.21);
  });

  it('averages the two middle samples of an even count', () => {
    const frames = Array.from({ length: 16 }, (_, index) =>
      frameWith(lost, handState('right', 'tracking', index < 8 ? 0.2 : 0.22)),
    );
    expect(deriveNeutralHandScale(frames)).toBeCloseTo(0.21, 12);
  });

  it('ignores hands that are not being tracked', () => {
    const frames = Array.from({ length: 40 }, (_, index) =>
      frameWith(
        handState('left', index % 2 === 0 ? 'holding' : 'lost', 0.5),
        handState('right', 'tracking', 0.2),
      ),
    );
    expect(deriveNeutralHandScale(frames)).toBe(0.2);
  });

  it('ignores scales that are not usable numbers', () => {
    const scales = [...new Array<number>(15).fill(0.2), Number.NaN, Number.POSITIVE_INFINITY, 0];
    const frames = scales.map((scale) => frameWith(lost, handState('right', 'tracking', scale)));
    expect(deriveNeutralHandScale(frames)).toBe(0.2);
    // On their own they are no calibration at all.
    const useless = new Array<number>(20).fill(Number.POSITIVE_INFINITY);
    expect(
      deriveNeutralHandScale(
        useless.map((scale) => frameWith(lost, handState('right', 'tracking', scale))),
      ),
    ).toBeNull();
  });

  it('returns null when the hand was not seen for long enough', () => {
    const frames = Array.from({ length: 10 }, () =>
      frameWith(lost, handState('right', 'tracking', 0.2)),
    );
    expect(deriveNeutralHandScale(frames)).toBeNull();
    expect(deriveNeutralHandScale([])).toBeNull();
  });

  it('can be restricted to one hand', () => {
    const frames = Array.from({ length: 20 }, () =>
      frameWith(handState('left', 'tracking', 0.3), handState('right', 'tracking', 0.2)),
    );
    expect(deriveNeutralHandScale(frames, 'left')).toBe(0.3);
    expect(deriveNeutralHandScale(frames, 'right')).toBe(0.2);
    expect(deriveNeutralHandScale(frames)).toBeCloseTo(0.25, 12);
  });
});
