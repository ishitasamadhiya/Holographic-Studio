/** Picks which camera frames to process so that no more than `maxFps` are taken per second. */
export class FrameRateLimiter {
  private readonly intervalMs: number;
  private readonly toleranceMs: number;
  private nextDueMs = Number.NEGATIVE_INFINITY;

  /** Throws a RangeError unless `maxFps` is a positive, finite number. */
  constructor(maxFps: number) {
    if (!Number.isFinite(maxFps) || maxFps <= 0) {
      throw new RangeError(`maxFps must be a positive number, got ${maxFps}`);
    }
    this.intervalMs = 1000 / maxFps;
    // Camera frames arrive with a few milliseconds of jitter. Without some tolerance a 30 fps
    // camera under a 30 fps cap would lose every frame that came slightly early, halving the rate.
    this.toleranceMs = this.intervalMs / 4;
  }

  /** True when the frame arriving at `nowMs` should be processed; accepting it uses up its slot. */
  accept(nowMs: number): boolean {
    if (nowMs < this.nextDueMs - this.toleranceMs) return false;
    // Keep the ideal schedule while frames are merely jittery (so the long-run rate is exact),
    // but restart it after a stall so the backlog is not paid back as a burst.
    const onSchedule = nowMs - this.nextDueMs < this.intervalMs;
    this.nextDueMs = (onSchedule ? this.nextDueMs : nowMs) + this.intervalMs;
    return true;
  }

  reset(): void {
    this.nextDueMs = Number.NEGATIVE_INFINITY;
  }
}
