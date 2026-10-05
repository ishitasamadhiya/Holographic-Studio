// Gesture maths: raw hand landmarks in, smoothed control values out. Pure TypeScript.
export type { GestureFrame, HandState, HandStatus, Landmark, RawHand, RawHandFrame } from './types';

export { GesturePipeline, type GesturePipelineOptions } from './gesturePipeline';
export { HOLD_DURATION_MS } from './handChannel';
export {
  ControlResolver,
  MAX_CONTROL_SPEED_PER_SEC,
  MAX_CONTROL_STEP,
  RECOVERY_BLEND_MS,
  RETURN_TO_MANUAL_MS,
  type ControlResolverConfig,
  type ControlStatus,
  type ResolvedControls,
} from './controlResolver';
export { ExtraGestureDetector, type ExtraGestureEvent } from './extraGestures';

export {
  DEFAULT_NEUTRAL_HAND_SCALE,
  deriveNeutralHandScale,
  proximityFromScale,
} from './proximity';
export { measureHandScale } from './handScale';
export { measureFingerExtensions, measureOpenness } from './openness';
export { measureHandConfidence, MIN_TRACKING_CONFIDENCE } from './confidence';
export { HandednessResolver, sideFromLabel, type HandAssignment } from './handedness';
export { OneEuroFilter, type OneEuroOptions } from './oneEuroFilter';
export { HAND_BONES, LANDMARK_COUNT } from './handTopology';
