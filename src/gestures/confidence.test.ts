import { describe, expect, it } from 'vitest';
import { measureHandConfidence, MIN_TRACKING_CONFIDENCE } from './confidence';
import { hasCompleteLandmarks } from './landmarkMath';
import { syntheticHand } from './testing/syntheticHand';

describe('hand confidence', () => {
  it('is full for a hand that is fully in view', () => {
    expect(measureHandConfidence(syntheticHand({ score: 0.96 }))).toBe(1);
  });

  it('drops as the hand leaves the frame', () => {
    const inView = measureHandConfidence(syntheticHand({ centre: { x: 0.5, y: 0.5 } }));
    const fingertipsCut = measureHandConfidence(syntheticHand({ centre: { x: 0.5, y: 0.14 } }));
    const mostlyGone = measureHandConfidence(syntheticHand({ centre: { x: 0.5, y: 0.02 } }));
    expect(fingertipsCut).toBeLessThan(inView);
    expect(mostlyGone).toBeLessThan(fingertipsCut);
    expect(mostlyGone).toBeLessThan(MIN_TRACKING_CONFIDENCE);
  });

  it('treats every image edge alike', () => {
    for (const centre of [
      { x: -0.02, y: 0.5 },
      { x: 1.02, y: 0.5 },
      { x: 0.5, y: 1.05 },
    ]) {
      expect(measureHandConfidence(syntheticHand({ centre }))).toBeLessThan(
        MIN_TRACKING_CONFIDENCE,
      );
    }
  });

  it('does not drop a fully visible hand whose left/right label is unsure', () => {
    // The score is handedness doubt: an edge-on flat hand reads about 0.6 on every frame.
    for (const score of [0.5, 0.6, 0.67]) {
      expect(measureHandConfidence(syntheticHand({ score }))).toBeGreaterThanOrEqual(
        MIN_TRACKING_CONFIDENCE,
      );
    }
  });

  it('is zero when the score is not a number', () => {
    // NaN would pass every "is it below the threshold?" check further down the line.
    for (const score of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(measureHandConfidence(syntheticHand({ score }))).toBe(0);
    }
  });

  it('is zero for a detection without landmarks', () => {
    expect(
      measureHandConfidence({ landmarks: [], worldLandmarks: [], label: 'Right', score: 1 }),
    ).toBe(0);
  });
});

describe('hasCompleteLandmarks', () => {
  it('accepts a full hand and rejects truncated or non-finite ones', () => {
    const hand = syntheticHand();
    expect(hasCompleteLandmarks(hand)).toBe(true);
    expect(hasCompleteLandmarks({ ...hand, landmarks: hand.landmarks.slice(0, 20) })).toBe(false);
    expect(hasCompleteLandmarks({ ...hand, worldLandmarks: [] })).toBe(false);
    const broken = hand.worldLandmarks.map((point, index) =>
      index === 3 ? { ...point, z: Number.NaN } : point,
    );
    expect(hasCompleteLandmarks({ ...hand, worldLandmarks: broken })).toBe(false);
  });
});
