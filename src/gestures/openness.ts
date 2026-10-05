// Openness: 0 = closed fist, 1 = open hand.
//
// Each finger is scored by how straight it is: the distance from its knuckle to its tip
// divided by the finger's own length along its bones. That ratio lives entirely inside one
// finger, so it cannot depend on hand size, distance from the camera, or how the hand is
// turned. It is measured on the tracker's 3D ("world") landmarks so that tilting the palm
// toward or away from the camera does not look like closing the hand; and because a straight
// finger stays straight under any error in the tracker's depth estimate, an open hand keeps
// reading as open even when that estimate is poor.
//
// The constants were calibrated on real hands (the photos in tests/e2e/fixtures/hands; their
// landmarks are replayed by recordedHands.test.ts): extended fingers measure 0.91–0.99, the
// fingers of a tight or relaxed fist 0.20–0.48.
//
// Two known limits, to revisit when the gesture is tuned on a live camera:
// - Straightness sees a finger curl but not a fold at the knuckle: four straight fingers bent
//   down at the knuckles alone still read as an open hand. The tracker's world landmarks do
//   not give a usable knuckle angle to add: on the same photos the fingers of flat open hands
//   stand 20–35° off the palm plane and curled ones 31–72°, so the two ranges overlap.
// - Only the two ends of the range are pinned by real hands. Where a half-curled finger falls
//   in between depends on the tracker's depth estimate, its least reliable axis.
import { clamp01 } from '@shared/controls';
import { FINGER_NAMES, FINGERS, THUMB, WRIST, type FingerName } from './handTopology';
import { distance, landmarkAt } from './landmarkMath';
import type { Landmark, RawHand } from './types';

/** Straightness at or below which a finger counts as fully curled. */
const FINGER_CURLED_STRAIGHTNESS = 0.5;
/** Straightness at or above which a finger counts as fully extended. */
const FINGER_EXTENDED_STRAIGHTNESS = 0.9;

// The thumb does not curl like a finger; what changes is how far its tip sits from the far
// (pinky) edge of the palm, measured in palm lengths. Real hands: 0.42–0.64 tucked into a
// fist, 0.90–1.29 held out.
const THUMB_TUCKED_REACH = 0.65;
const THUMB_EXTENDED_REACH = 0.9;

/** The thumb's share of the result; the four fingers split the rest equally. */
const THUMB_WEIGHT = 0.1;
const FINGER_WEIGHT = (1 - THUMB_WEIGHT) / FINGER_NAMES.length;

/**
 * Dead zones: extension below the first is a fist (exactly 0), above the second an open hand
 * (exactly 1). Both are wider than the thumb's weight, so the thumb alone can never lift a
 * fist off 0 (thumbs-up) or pull an open hand off 1 (thumb tucked in).
 */
const FIST_DEAD_ZONE = 0.15;
const OPEN_DEAD_ZONE = 0.15;

function ramp(value: number, from: number, to: number): number {
  return clamp01((value - from) / (to - from));
}

function fingerStraightness(world: readonly Landmark[], finger: FingerName): number {
  const joints = FINGERS[finger];
  const knuckle = landmarkAt(world, joints.base);
  const middle = landmarkAt(world, joints.middle);
  const distal = landmarkAt(world, joints.distal);
  const tip = landmarkAt(world, joints.tip);
  const boneLength = distance(knuckle, middle) + distance(middle, distal) + distance(distal, tip);
  return boneLength > 0 ? distance(knuckle, tip) / boneLength : 0;
}

function thumbExtension(world: readonly Landmark[]): number {
  const palmLength = distance(landmarkAt(world, WRIST), landmarkAt(world, FINGERS.middle.base));
  if (palmLength <= 0) return 0;
  const reach =
    distance(landmarkAt(world, THUMB.tip), landmarkAt(world, FINGERS.pinky.base)) / palmLength;
  return ramp(reach, THUMB_TUCKED_REACH, THUMB_EXTENDED_REACH);
}

/** How extended each finger is: 0 = fully curled, 1 = fully straight. */
export function measureFingerExtensions(hand: RawHand): Record<FingerName, number> {
  const extension = (finger: FingerName): number =>
    ramp(
      fingerStraightness(hand.worldLandmarks, finger),
      FINGER_CURLED_STRAIGHTNESS,
      FINGER_EXTENDED_STRAIGHTNESS,
    );
  return {
    index: extension('index'),
    middle: extension('middle'),
    ring: extension('ring'),
    pinky: extension('pinky'),
  };
}

/**
 * Overall extension of the hand, 0..1, before the dead zones are applied. This is the value
 * that gets smoothed; opennessFromExtension turns it into the final openness.
 */
export function measureHandExtension(hand: RawHand): number {
  const fingers = measureFingerExtensions(hand);
  const fingerTotal = FINGER_NAMES.reduce((total, finger) => total + fingers[finger], 0);
  return FINGER_WEIGHT * fingerTotal + THUMB_WEIGHT * thumbExtension(hand.worldLandmarks);
}

/** Applies the dead zones: linear in between, exactly 0 for a fist and exactly 1 for an open hand. */
export function opennessFromExtension(extension: number): number {
  return ramp(extension, FIST_DEAD_ZONE, 1 - OPEN_DEAD_ZONE);
}

/** Unsmoothed openness of one detected hand. */
export function measureOpenness(hand: RawHand): number {
  return opennessFromExtension(measureHandExtension(hand));
}
