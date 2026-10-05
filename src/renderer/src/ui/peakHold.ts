// Peak-hold ballistics for level meters: the marker jumps up with the signal, stays put for
// a moment so a short peak can actually be seen, then falls back at a steady rate.

export interface PeakHoldOptions {
  /** How long a peak stays where it is before it starts to fall. */
  holdMs: number;
  /** Fall rate after the hold, in full-scale units (0..1) per second. */
  decayPerSecond: number;
}

export class PeakHold {
  private peak = 0;
  private holdUntilMs = 0;
  private lastUpdateMs = 0;

  constructor(private readonly options: PeakHoldOptions) {}

  /** Feeds the current level (0..1) at time `nowMs` and returns the peak to display. */
  update(level: number, nowMs: number): number {
    if (level >= this.peak) {
      this.peak = level;
      this.holdUntilMs = nowMs + this.options.holdMs;
    } else if (nowMs > this.holdUntilMs) {
      // Only the time since the hold ran out counts, however long ago the last update was.
      const fallingSinceMs = Math.max(this.lastUpdateMs, this.holdUntilMs);
      const fallen = ((nowMs - fallingSinceMs) / 1000) * this.options.decayPerSecond;
      this.peak = Math.max(level, this.peak - fallen);
    }
    this.lastUpdateMs = nowMs;
    return this.peak;
  }

  reset(): void {
    this.peak = 0;
    this.holdUntilMs = 0;
    this.lastUpdateMs = 0;
  }
}
