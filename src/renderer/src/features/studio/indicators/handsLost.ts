import type { GestureFrame } from '@gestures/index';

/** How long both hands must be out of view before the hint appears. */
export const HANDS_HINT_DELAY_MS = 2000;

/** True when neither hand is tracked or briefly held. No frame at all counts as lost. */
export function areBothHandsLost(frame: GestureFrame | null): boolean {
  return frame === null || (frame.left.status === 'lost' && frame.right.status === 'lost');
}

export interface HandsLostTimer {
  /** Feed it every frame; true once the hands have been lost for the whole delay. */
  update(bothLost: boolean, nowMs: number): boolean;
  reset(): void;
}

/**
 * Decides when to show "Show your hands…". A hand dipping out of view for a moment is
 * normal while performing, so the hint waits, and it goes away the instant a hand is back.
 */
export function createHandsLostTimer(delayMs = HANDS_HINT_DELAY_MS): HandsLostTimer {
  let lostSinceMs: number | null = null;

  return {
    update(bothLost, nowMs) {
      if (!bothLost) {
        lostSinceMs = null;
        return false;
      }
      lostSinceMs ??= nowMs;
      return nowMs - lostSinceMs >= delayMs;
    },
    reset() {
      lostSinceMs = null;
    },
  };
}
