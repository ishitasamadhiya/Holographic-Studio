import { LANDMARK_COUNT } from './handTopology';
import type { Landmark, RawHand } from './types';

/** Reads one landmark of a hand that has already passed hasCompleteLandmarks. */
export function landmarkAt(landmarks: readonly Landmark[], index: number): Landmark {
  const landmark = landmarks[index];
  if (!landmark) throw new RangeError(`Hand landmark ${index} is missing`);
  return landmark;
}

/** Straight-line distance in three dimensions. */
export function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function isFinitePoint(point: Landmark): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

/** True when the hand carries all 21 image and world landmarks as finite numbers. */
export function hasCompleteLandmarks(hand: RawHand): boolean {
  return (
    hand.landmarks.length === LANDMARK_COUNT &&
    hand.worldLandmarks.length === LANDMARK_COUNT &&
    hand.landmarks.every(isFinitePoint) &&
    hand.worldLandmarks.every(isFinitePoint)
  );
}
