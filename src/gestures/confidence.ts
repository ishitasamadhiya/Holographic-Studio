import type { Landmark, RawHand } from './types';

/**
 * Detections below this confidence never move the gesture values: the hand is treated as
 * momentarily lost and its last values are held instead. 0.7 lets up to six of the 21 points
 * (say, two fingertips and their end joints) sit just outside the picture.
 */
export const MIN_TRACKING_CONFIDENCE = 0.7;

function isInsideImage(landmark: Landmark): boolean {
  return landmark.x >= 0 && landmark.x <= 1 && landmark.y >= 0 && landmark.y <= 1;
}

/**
 * How far one detection's measurements can be trusted, 0..1: the share of the hand that is
 * inside the picture. When part of the hand leaves the frame the tracker still reports all 21
 * points, but the ones outside the image are guesses, and finger pose and palm size computed
 * from guesses would swing the controls.
 *
 * The tracker's score is deliberately not part of it. HandLandmarker applies its own
 * hand-presence threshold before reporting a hand at all and then reports only a handedness
 * score, which measures left-versus-right doubt, not how well the hand is seen: a fully
 * visible flat hand turned edge-on reads 0.55-0.67 on every frame. The score weighs the
 * handedness vote instead (see handedness.ts). A detection without a usable score is
 * malformed and gets no confidence at all, which also keeps NaN out of every comparison
 * downstream.
 */
export function measureHandConfidence(hand: RawHand): number {
  if (hand.landmarks.length === 0 || !Number.isFinite(hand.score)) return 0;
  return hand.landmarks.filter(isInsideImage).length / hand.landmarks.length;
}
