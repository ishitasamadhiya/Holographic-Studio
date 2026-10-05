import { describe, expect, it } from 'vitest';
import {
  measureFingerExtensions,
  measureHandExtension,
  measureOpenness,
  opennessFromExtension,
} from './openness';
import { syntheticHand, type SyntheticHandOptions } from './testing/syntheticHand';

const opennessOf = (options: SyntheticHandOptions): number =>
  measureOpenness(syntheticHand(options));

describe('openness', () => {
  it('is exactly 1 for a flat open hand and exactly 0 for a fist', () => {
    expect(opennessOf({ closure: 0 })).toBe(1);
    expect(opennessOf({ closure: 1 })).toBe(0);
  });

  it('has dead zones: a relaxed open hand is still 1 and a relaxed fist is still 0', () => {
    expect(opennessOf({ closure: 0.2 })).toBe(1);
    expect(opennessOf({ closure: 0.85 })).toBe(0);
  });

  it('puts a half-closed hand in between', () => {
    const half = opennessOf({ closure: 0.55 });
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.8);
  });

  it('falls smoothly and monotonically as the hand closes', () => {
    let previous = opennessOf({ closure: 0 });
    let strictlyFallingSteps = 0;
    for (let step = 1; step <= 100; step += 1) {
      const current = opennessOf({ closure: step / 100 });
      expect(current).toBeLessThanOrEqual(previous);
      // No cliffs: one percent of closure never moves the result by more than five percent.
      expect(previous - current).toBeLessThan(0.05);
      if (current < previous) strictlyFallingSteps += 1;
      previous = current;
    }
    // The live range between the dead zones spans a substantial part of the motion.
    expect(strictlyFallingSteps).toBeGreaterThanOrEqual(30);
  });

  it('does not depend on apparent size, position, in-plane rotation, hand size or which hand it is', () => {
    for (const closure of [0, 0.45, 0.55, 0.65, 1]) {
      const reference = opennessOf({ closure });
      const variations: SyntheticHandOptions[] = [
        { palmScale: 0.07 },
        { palmScale: 0.34 },
        { centre: { x: 0.12, y: 0.8 } },
        { centre: { x: 0.85, y: 0.2 } },
        { rollDeg: 45 },
        { rollDeg: -90 },
        { rollDeg: 180 },
        { handSize: 0.8 },
        { handSize: 1.25 },
        { side: 'left' },
        { imageAspect: 4 / 3 },
        { side: 'left', rollDeg: 130, palmScale: 0.1, centre: { x: 0.3, y: 0.3 }, handSize: 1.1 },
      ];
      for (const variation of variations) {
        expect(opennessOf({ closure, ...variation })).toBeCloseTo(reference, 9);
      }
    }
  });

  it('does not change when the palm tilts toward or away from the camera', () => {
    for (const closure of [0, 0.5, 0.6, 1]) {
      const reference = opennessOf({ closure });
      for (const [pitchDeg, yawDeg] of [
        [35, 0],
        [-35, 0],
        [0, 35],
        [0, -35],
        [25, -25],
      ] as const) {
        expect(opennessOf({ closure, pitchDeg, yawDeg })).toBeCloseTo(reference, 9);
      }
    }
  });

  it('weights the thumb lightly: on its own it can neither open a fist nor close an open hand', () => {
    expect(opennessOf({ closure: 1, thumbClosure: 0 })).toBe(0);
    expect(opennessOf({ closure: 0, thumbClosure: 1 })).toBe(1);

    // In the live range the thumb does contribute, but far less than the fingers do.
    const thumbOut = opennessOf({ closure: 0.55, thumbClosure: 0 });
    const thumbIn = opennessOf({ closure: 0.55, thumbClosure: 1 });
    expect(thumbOut).toBeGreaterThan(thumbIn);
    expect(thumbOut - thumbIn).toBeLessThan(0.2);
  });

  it('combines the four fingers equally', () => {
    const oneFinger = opennessOf({ closure: 1, fingerClosure: { index: 0 } });
    const twoFingers = opennessOf({ closure: 1, fingerClosure: { index: 0, middle: 0 } });
    const otherTwo = opennessOf({ closure: 1, fingerClosure: { ring: 0, pinky: 0 } });
    const threeFingers = opennessOf({
      closure: 1,
      fingerClosure: { index: 0, middle: 0, ring: 0 },
    });
    expect(oneFinger).toBeGreaterThan(0);
    expect(twoFingers).toBeGreaterThan(oneFinger);
    expect(threeFingers).toBeGreaterThan(twoFingers);
    expect(threeFingers).toBeLessThan(1);
    expect(otherTwo).toBeCloseTo(twoFingers, 9);
  });

  it('reports each finger separately', () => {
    const victory = syntheticHand({ closure: 1, fingerClosure: { index: 0, middle: 0 } });
    expect(measureFingerExtensions(victory)).toEqual({ index: 1, middle: 1, ring: 0, pinky: 0 });

    const halfCurled = measureFingerExtensions(syntheticHand({ closure: 0.55 }));
    for (const extension of Object.values(halfCurled)) {
      expect(extension).toBeGreaterThan(0.2);
      expect(extension).toBeLessThan(0.9);
    }
  });

  it('maps extension to openness linearly between the dead zones', () => {
    expect(opennessFromExtension(0)).toBe(0);
    expect(opennessFromExtension(0.15)).toBe(0);
    expect(opennessFromExtension(0.5)).toBeCloseTo(0.5, 9);
    expect(opennessFromExtension(0.85)).toBe(1);
    expect(opennessFromExtension(1)).toBe(1);
    expect(opennessFromExtension(0.675) - opennessFromExtension(0.5)).toBeCloseTo(0.25, 9);
  });

  it('keeps the raw extension within 0..1', () => {
    expect(measureHandExtension(syntheticHand({ closure: 0 }))).toBeCloseTo(1, 9);
    expect(measureHandExtension(syntheticHand({ closure: 1 }))).toBeCloseTo(0, 9);
  });
});
