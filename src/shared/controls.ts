// The three live vocal controls and how gestures are bound to them.
// Outside the DSP every control is a normalized number from 0 to 1.

export type ControlId = 'autotune' | 'echo' | 'volume';
export const CONTROL_IDS: readonly ControlId[] = ['autotune', 'echo', 'volume'];

/** Where a control takes its value from. */
export type ControlSource = 'gesture' | 'manual';

export type ControlValues = Record<ControlId, number>;

/** The performer's own left/right hand (not the side of the image it appears on). */
export type HandSide = 'left' | 'right';

/**
 * openness:  0 = closed fist, 1 = fully open hand.
 * proximity: 0 = far from the camera, 0.5 = the calibrated resting distance, 1 = close.
 */
export type GestureFeature = 'openness' | 'proximity';

export interface GestureBinding {
  control: ControlId;
  hand: HandSide;
  feature: GestureFeature;
}

/** Data-driven so that gesture customization can be added later without touching the pipeline. */
export const DEFAULT_GESTURE_BINDINGS: readonly GestureBinding[] = [
  { control: 'autotune', hand: 'right', feature: 'openness' },
  { control: 'volume', hand: 'right', feature: 'proximity' },
  { control: 'echo', hand: 'left', feature: 'openness' },
];

/**
 * Vocal volume range. 0.5 is unity gain; the ceiling is deliberately modest so a hand
 * moving toward the camera can never make the voice painfully loud.
 */
export const VOCAL_VOLUME_MIN_DB = -12;
export const VOCAL_VOLUME_MAX_DB = 5;
export const VOCAL_VOLUME_UNITY = 0.5;

/** Maps the normalized volume control (0..1) to decibels: piecewise linear through unity. */
export function vocalVolumeToDb(normalized: number): number {
  const value = Math.min(1, Math.max(0, normalized));
  if (value <= VOCAL_VOLUME_UNITY) {
    return VOCAL_VOLUME_MIN_DB * (1 - value / VOCAL_VOLUME_UNITY);
  }
  return (VOCAL_VOLUME_MAX_DB * (value - VOCAL_VOLUME_UNITY)) / (1 - VOCAL_VOLUME_UNITY);
}

/** Maps the normalized volume control (0..1) to a linear gain factor. */
export function vocalVolumeToGain(normalized: number): number {
  return 10 ** (vocalVolumeToDb(normalized) / 20);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
