// How the normalized 0..1 controls turn into DSP parameters. Kept in one place so the feel of
// each gesture can be tuned without touching the signal processing.
import { clamp01 } from '@shared/controls';

// ── Autotune ──────────────────────────────────────────────────────────────────────────────
//
// One intensity value drives two things:
//
//   amount  how much of the pitch error is removed (0 = none, 1 = all of it)
//   retune  how quickly the correction follows the singer (time constant, seconds)
//
//   intensity   amount   retune    character
//     0.00       0.00    200 ms    off: the voice is untouched
//     0.25       0.44    154 ms    barely there; long notes drift toward pitch
//     0.50       0.75     70 ms    natural correction; vibrato and scoops survive
//     0.75       0.94     19 ms    tight, modern pop tuning
//     1.00       1.00      4 ms    hard tune: notes snap, vibrato is flattened
//
// The amount eases out (1 − (1 − x)²) so the effect is already useful at small hand openings.
// The retune time falls exponentially with x², so it stays slow — vibrato is slower than the
// correction and therefore preserved — over the first half of the range and only becomes
// robotic near the top.

export const AUTOTUNE_RETUNE_SLOW_SEC = 0.2;
export const AUTOTUNE_RETUNE_FAST_SEC = 0.004;

/** Corrections are never larger than this, whatever the target logic asks for. */
export const AUTOTUNE_MAX_CORRECTION_SEMITONES = 3;

/** Fraction of the pitch error that is corrected, 0..1. Exactly 0 at intensity 0 and 1 at 1. */
export function autotuneAmount(intensity: number): number {
  const remaining = 1 - clamp01(intensity);
  return 1 - remaining * remaining;
}

/** Time constant of the correction glide in seconds. */
export function autotuneRetuneSeconds(intensity: number): number {
  const position = clamp01(intensity);
  return (
    AUTOTUNE_RETUNE_SLOW_SEC *
    (AUTOTUNE_RETUNE_FAST_SEC / AUTOTUNE_RETUNE_SLOW_SEC) ** (position * position)
  );
}

// ── Echo ──────────────────────────────────────────────────────────────────────────────────
//
//   wet       level of the echoes relative to the dry voice (how much is sent into the delay)
//   feedback  how much of each echo is fed back to make the next one
//
//   intensity    wet    feedback   repeats audible (to −40 dB)
//     0.00      0.00      0.30     none — nothing is sent, an existing tail fades out
//     0.50      0.17      0.42     about 4
//     1.00      0.48      0.55     about 7
//
// The wet level follows x^1.5: finer control at the subtle end, where the ear is most
// sensitive to changes in a quiet echo.

export const ECHO_MAX_WET = 0.48;
export const ECHO_MIN_FEEDBACK = 0.3;
export const ECHO_MAX_FEEDBACK = 0.55;

/**
 * Absolute ceiling for the feedback gain. Every element in the echo's feedback loop has a
 * gain of at most 1, so any feedback below 1 is stable; 0.7 leaves a wide safety margin and
 * keeps the longest possible tail under ~6 s.
 */
export const ECHO_FEEDBACK_CAP = 0.7;

/** Echo level relative to the dry voice. Exactly 0 at intensity 0. */
export function echoWet(intensity: number): number {
  const position = clamp01(intensity);
  return ECHO_MAX_WET * position * Math.sqrt(position);
}

/** Feedback gain for an echo intensity; never above ECHO_FEEDBACK_CAP. */
export function echoFeedback(intensity: number): number {
  const position = clamp01(intensity);
  return limitEchoFeedback(ECHO_MIN_FEEDBACK + (ECHO_MAX_FEEDBACK - ECHO_MIN_FEEDBACK) * position);
}

/** Forces any feedback value into the stable range [0, ECHO_FEEDBACK_CAP]. */
export function limitEchoFeedback(feedback: number): number {
  if (!(feedback > 0)) return 0;
  return feedback > ECHO_FEEDBACK_CAP ? ECHO_FEEDBACK_CAP : feedback;
}
