import { describe, expect, it } from 'vitest';
import { FINGERS, WRIST } from './handTopology';
import { measureHandScale, palmCentre } from './handScale';
import { landmarkAt } from './landmarkMath';
import {
  SYNTHETIC_IMAGE_ASPECT,
  syntheticHand,
  type SyntheticHandOptions,
} from './testing/syntheticHand';

function scaleOf(options: SyntheticHandOptions): number {
  const hand = syntheticHand(options);
  return measureHandScale(hand.landmarks, options.imageAspect ?? SYNTHETIC_IMAGE_ASPECT);
}

/** The obvious measure the real one improves on: the wrist-to-middle-knuckle distance in the image. */
function naivePalmLength(options: SyntheticHandOptions): number {
  const { landmarks } = syntheticHand(options);
  const aspect = options.imageAspect ?? SYNTHETIC_IMAGE_ASPECT;
  const wrist = landmarkAt(landmarks, WRIST);
  const knuckle = landmarkAt(landmarks, FINGERS.middle.base);
  return Math.hypot((knuckle.x - wrist.x) * aspect, knuckle.y - wrist.y);
}

describe('hand scale', () => {
  it('reports the apparent palm length as a fraction of image height', () => {
    for (const palmScale of [0.06, 0.18, 0.3, 0.45]) {
      expect(scaleOf({ palmScale })).toBeCloseTo(palmScale, 6);
    }
  });

  it('is proportional to how close the hand is, whatever the real size of the hand', () => {
    expect(scaleOf({ palmScale: 0.36 }) / scaleOf({ palmScale: 0.18 })).toBeCloseTo(2, 6);
    expect(scaleOf({ palmScale: 0.2, handSize: 0.8 })).toBeCloseTo(0.2, 6);
  });

  it('does not change when the fingers open or close', () => {
    for (const closure of [0, 0.3, 0.6, 1]) {
      expect(scaleOf({ palmScale: 0.2, closure })).toBeCloseTo(0.2, 6);
    }
    expect(scaleOf({ palmScale: 0.2, closure: 1, fingerClosure: { index: 0 } })).toBeCloseTo(
      0.2,
      6,
    );
  });

  it('does not depend on position, in-plane rotation or which hand it is', () => {
    const variations: SyntheticHandOptions[] = [
      { centre: { x: 0.1, y: 0.85 } },
      { rollDeg: 30 },
      { rollDeg: 90 },
      { rollDeg: -145 },
      { side: 'left' },
      { side: 'left', rollDeg: 70, centre: { x: 0.7, y: 0.3 } },
    ];
    for (const variation of variations) {
      expect(scaleOf({ palmScale: 0.2, ...variation })).toBeCloseTo(0.2, 6);
    }
  });

  it('corrects for the image aspect ratio', () => {
    // A hand lying sideways measures its length along x, where normalized units are wider.
    for (const imageAspect of [4 / 3, 16 / 9, 1, 9 / 16]) {
      expect(scaleOf({ palmScale: 0.2, rollDeg: 90, imageAspect })).toBeCloseTo(0.2, 6);
      expect(scaleOf({ palmScale: 0.2, rollDeg: 0, imageAspect })).toBeCloseTo(0.2, 6);
    }
  });

  it('holds steady when a rigid flat palm tilts away from the camera, unlike a plain distance', () => {
    // Exact only for this idealised palm: on real tracker output a simulated 45° tilt still
    // moved the measure by 3-21 %, so this proves the geometry, not real-camera behaviour.
    const tilts = [
      { pitchDeg: 40, yawDeg: 0 },
      { pitchDeg: -40, yawDeg: 0 },
      { pitchDeg: 0, yawDeg: 40 },
      { pitchDeg: 30, yawDeg: 30 },
      { pitchDeg: -25, yawDeg: 35, rollDeg: 60 },
    ];
    for (const tilt of tilts) {
      expect(scaleOf({ palmScale: 0.2, ...tilt })).toBeCloseTo(0.2, 2);
    }
    // The same 40° tilt foreshortens the naive measure by cos(40°) ≈ 23 %.
    expect(naivePalmLength({ palmScale: 0.2, pitchDeg: 40 })).toBeLessThan(0.16);
  });

  it('locates the palm centre in image heights', () => {
    const hand = syntheticHand({ centre: { x: 0.25, y: 0.6 }, closure: 0.7, rollDeg: 20 });
    const centre = palmCentre(hand.landmarks, SYNTHETIC_IMAGE_ASPECT);
    expect(centre.x).toBeCloseTo(0.25 * SYNTHETIC_IMAGE_ASPECT, 6);
    expect(centre.y).toBeCloseTo(0.6, 6);
  });
});
