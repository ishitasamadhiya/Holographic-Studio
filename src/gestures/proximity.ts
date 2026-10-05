// Proximity: how close the hand is to the camera relative to a neutral (resting) distance.
// Apparent size is inversely proportional to distance, so equal steps of proximity are equal
// RATIOS of hand scale: 0.5 at the neutral scale, 1 at twice that size (half the distance),
// 0 at half that size (twice the distance).
import { clamp01, type HandSide } from '@shared/controls';
import type { GestureFrame } from './types';

/**
 * Hand scale (see handScale.ts) used as "neutral" until the performer calibrates: a palm
 * spanning 18 % of the image height, roughly a hand held 60–70 cm from a laptop camera.
 * At this value the whole 0..1 range fits in view: at proximity 1 an open hand fills about
 * three quarters of the image height.
 */
export const DEFAULT_NEUTRAL_HAND_SCALE = 0.18;

/** A calibration needs at least this many tracked samples (about half a second of video). */
const MIN_CALIBRATION_SAMPLES = 15;

/**
 * Where a hand scale sits on the proximity axis before the neutral point is applied:
 * +0.5 per doubling of scale. Smoothing is done on this axis so that it behaves the same at
 * every distance.
 */
export function scaleToProximityAxis(scale: number): number {
  return 0.5 * Math.log2(scale);
}

/** Proximity (0..1, clamped) for a position on the proximity axis. */
export function proximityOnAxis(axisPosition: number, neutralScale: number): number {
  return clamp01(0.5 + axisPosition - scaleToProximityAxis(neutralScale));
}

/** Proximity (0..1, clamped) for a hand scale: 0.5 at `neutralScale`, 1 at 2×, 0 at 0.5×. */
export function proximityFromScale(
  scale: number,
  neutralScale: number = DEFAULT_NEUTRAL_HAND_SCALE,
): number {
  return proximityOnAxis(scaleToProximityAxis(scale), neutralScale);
}

/** A usable neutral scale, falling back to the default for null or nonsensical input. */
export function resolveNeutralHandScale(scale: number | null | undefined): number {
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 0
    ? scale
    : DEFAULT_NEUTRAL_HAND_SCALE;
}

/**
 * Derives the performer's neutral hand scale from a few seconds of gesture frames recorded
 * while they hold their hand(s) at a comfortable resting distance. Uses the median, so a few
 * stray frames do not matter. Returns null when there were too few tracked samples.
 *
 * @param side restrict the calibration to one hand; by default every tracked hand counts.
 */
export function deriveNeutralHandScale(
  frames: readonly GestureFrame[],
  side?: HandSide,
): number | null {
  const sides: readonly HandSide[] = side ? [side] : ['left', 'right'];
  const samples: number[] = [];
  for (const frame of frames) {
    for (const candidate of sides) {
      const hand = frame[candidate];
      if (hand.status === 'tracking' && Number.isFinite(hand.scale) && hand.scale > 0) {
        samples.push(hand.scale);
      }
    }
  }
  if (samples.length < MIN_CALIBRATION_SAMPLES) return null;

  samples.sort((a, b) => a - b);
  const middle = Math.floor(samples.length / 2);
  const upper = samples[middle];
  const lower = samples[middle - 1];
  if (upper === undefined || lower === undefined) return null;
  return samples.length % 2 === 0 ? (lower + upper) / 2 : upper;
}
