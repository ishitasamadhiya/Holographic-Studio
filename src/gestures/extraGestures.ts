// Optional extra gestures. They are only wired up when the performer turns them on
// (Settings.controls.extraGesturesEnabled, off by default), because a deliberate pose held
// for a moment can also happen by accident mid-performance.
import { measureHandConfidence, MIN_TRACKING_CONFIDENCE } from './confidence';
import { HoldTrigger } from './holdTrigger';
import { hasCompleteLandmarks } from './landmarkMath';
import { measureFingerExtensions } from './openness';
import type { GestureFrame, HandState, RawHand, RawHandFrame } from './types';

/**
 * toggle-reverb:    a victory / peace sign held for about 0.8 s (either hand).
 * toggle-recording: both hands held as fists for about 1.5 s. With the default bindings two
 *                   fists are also autotune 0 and echo 0, a pose a performer may well rest
 *                   in; only offer this once that collision is resolved in the product.
 */
export type ExtraGestureEvent = 'toggle-reverb' | 'toggle-recording';

const VICTORY_HOLD_MS = 800;
const VICTORY_COOLDOWN_MS = 1500;
const BOTH_FISTS_HOLD_MS = 1500;
const BOTH_FISTS_COOLDOWN_MS = 3000;

/** Finger extension (0..1) above which a finger counts as raised, and below which as folded. */
const RAISED_FINGER = 0.8;
const FOLDED_FINGER = 0.6;
/** Smoothed openness at or below which a hand counts as a fist. */
const FIST_OPENNESS = 0.05;

function isVictorySign(hand: RawHand): boolean {
  if (!hasCompleteLandmarks(hand) || measureHandConfidence(hand) < MIN_TRACKING_CONFIDENCE) {
    return false;
  }
  const fingers = measureFingerExtensions(hand);
  return (
    fingers.index >= RAISED_FINGER &&
    fingers.middle >= RAISED_FINGER &&
    fingers.ring <= FOLDED_FINGER &&
    fingers.pinky <= FOLDED_FINGER
  );
}

function isFist(hand: HandState): boolean {
  return hand.status === 'tracking' && hand.openness <= FIST_OPENNESS;
}

export class ExtraGestureDetector {
  private readonly victory = new HoldTrigger({
    holdMs: VICTORY_HOLD_MS,
    cooldownMs: VICTORY_COOLDOWN_MS,
  });
  private readonly bothFists = new HoldTrigger({
    holdMs: BOTH_FISTS_HOLD_MS,
    cooldownMs: BOTH_FISTS_COOLDOWN_MS,
  });

  /**
   * Feed every tracker frame together with the gesture frame computed from it. Returns the
   * events that fired on this frame (usually none).
   */
  update(frame: GestureFrame, raw: RawHandFrame): ExtraGestureEvent[] {
    const events: ExtraGestureEvent[] = [];
    if (this.victory.update(raw.hands.some(isVictorySign), frame.timestampMs)) {
      events.push('toggle-reverb');
    }
    if (this.bothFists.update(isFist(frame.left) && isFist(frame.right), frame.timestampMs)) {
      events.push('toggle-recording');
    }
    return events;
  }

  reset(): void {
    this.victory.reset();
    this.bothFists.reset();
  }
}
