/** A pose may be seen to drop out for this long (a missed detection, a noisy frame) without restarting its hold. */
const FLICKER_TOLERANCE_MS = 150;
/**
 * Longest stretch without any sighting of the pose that a hold may span. It is a little longer
 * than the flicker tolerance so that one missed detection is still bridged at 10 frames per
 * second, but no longer: when the tracker goes quiet (the display sleeps, the camera restarts)
 * nobody saw the pose being held in between, and two sightings seconds apart are not a hold.
 */
const MAX_UNSEEN_GAP_MS = 300;

export interface HoldTriggerOptions {
  /** How long the pose must be held before it fires. */
  holdMs: number;
  /** After firing, how long before a new hold can begin. */
  cooldownMs: number;
}

/**
 * Debounces a held pose into a single event: fires once when the pose has been held for
 * `holdMs`, then stays quiet until the pose has been let go and the cooldown has passed.
 */
export class HoldTrigger {
  private readonly options: HoldTriggerOptions;
  private heldSinceMs: number | null = null;
  private lastActiveMs = 0;
  private hasFired = false;
  private readyAtMs = Number.NEGATIVE_INFINITY;

  constructor(options: HoldTriggerOptions) {
    this.options = options;
  }

  /**
   * Feeds whether the pose is present at `nowMs` (an update whose time is not a finite number
   * is ignored). Returns true on the one update where it fires.
   */
  update(active: boolean, nowMs: number): boolean {
    if (!Number.isFinite(nowMs)) return false;
    const unseenForMs = nowMs - this.lastActiveMs;

    if (!active) {
      if (this.heldSinceMs !== null && unseenForMs > FLICKER_TOLERANCE_MS) {
        this.heldSinceMs = null;
        this.hasFired = false;
      }
      return false;
    }

    // After a blind gap the hold starts over. Whether the pose was let go in the meantime is
    // unknown, so a hold that had already fired stays fired until it is seen to be released.
    const brokenByGap = this.heldSinceMs !== null && unseenForMs > MAX_UNSEEN_GAP_MS;
    this.lastActiveMs = nowMs;
    // A pose struck during the cooldown only starts counting once the cooldown is over.
    if (this.heldSinceMs === null || brokenByGap || nowMs < this.readyAtMs) {
      this.heldSinceMs = nowMs;
    }
    if (this.hasFired || nowMs - this.heldSinceMs < this.options.holdMs) return false;

    this.hasFired = true;
    this.readyAtMs = nowMs + this.options.cooldownMs;
    return true;
  }

  reset(): void {
    this.heldSinceMs = null;
    this.lastActiveMs = 0;
    this.hasFired = false;
    this.readyAtMs = Number.NEGATIVE_INFINITY;
  }
}
