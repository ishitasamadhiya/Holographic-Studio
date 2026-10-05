// Real-time vocal DSP. Pure TypeScript: no DOM, Node or Electron imports, so the same code
// runs in an AudioWorklet, in a worker, and in Node for tests.

export type { EffectUnit } from './effectUnit';
export {
  DEFAULT_VOCAL_CHAIN_CONTROLS,
  VocalChain,
  type VocalChainControls,
  type VocalChainMeters,
  type VocalChainOptions,
} from './vocalChain';

export {
  AUTOTUNE_MAX_CORRECTION_SEMITONES,
  AUTOTUNE_RETUNE_FAST_SEC,
  AUTOTUNE_RETUNE_SLOW_SEC,
  autotuneAmount,
  autotuneRetuneSeconds,
  ECHO_FEEDBACK_CAP,
  ECHO_MAX_FEEDBACK,
  ECHO_MAX_WET,
  ECHO_MIN_FEEDBACK,
  echoFeedback,
  echoWet,
  limitEchoFeedback,
} from './parameterMapping';

export { AutotuneUnit } from './autotune/autotuneUnit';
export { MelodyTimeline } from './autotune/melodyTimeline';
export { NoteChoicePitch } from './autotune/noteChoicePitch';
export {
  createPitchClassMask,
  fillPitchClassMask,
  foldToNearestOctave,
  nearestAllowedNote,
  type PitchClassMask,
} from './autotune/scale';
export {
  MELODY_PULL_RANGE_SEMITONES,
  MELODY_WINDOW_SEC,
  PitchTargetSelector,
  TARGET_HYSTERESIS_SEMITONES,
  type TargetSource,
} from './autotune/targetSelector';

export { designLowpassFir } from './pitch/decimator';
export { computeNsdf, NsdfPeaks } from './pitch/nsdf';
export { PeriodRefiner } from './pitch/periodRefiner';
export {
  CLARITY_THRESHOLD,
  PITCH_MAX_HZ,
  PITCH_MIN_HZ,
  PitchDetector,
  type PitchDetectorOptions,
} from './pitch/pitchDetector';
export { PitchShifter, type PitchShifterOptions } from './pitch/pitchShifter';
export { SpliceSearch } from './pitch/spliceSearch';

export { ECHO_DELAY_SEC, EchoUnit } from './effects/echo';
export { GainUnit } from './effects/gain';
export { LIMITER_CEILING, LIMITER_THRESHOLD, LimiterUnit } from './effects/limiter';
export { ReverbUnit } from './effects/reverb';

export { BiquadHighpass } from './filters';
export { MirroredHistory } from './history';
export {
  clamp,
  decibelsToGain,
  DENORMAL_FLOOR,
  flushDenormal,
  nextPowerOfTwo,
  parabolicPeakOffset,
  parabolicPeakValue,
  semitonesToRatio,
} from './math';
export { OnePoleSmoother, smoothingCoefficient } from './smoothing';
