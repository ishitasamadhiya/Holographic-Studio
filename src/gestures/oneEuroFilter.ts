// One Euro filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass filter whose cutoff rises
// with the speed of the signal. Held still, a hand gets heavy smoothing (no jitter); moved
// quickly, it gets very little (no lag).

export interface OneEuroOptions {
  /** Cutoff in Hz while the signal is still. Lower = steadier at rest. */
  minCutoffHz: number;
  /** How much the cutoff rises per unit of speed (signal units per second). Higher = less lag. */
  speedCoefficient: number;
  /** Cutoff in Hz for the speed estimate itself. */
  derivativeCutoffHz: number;
}

/** Tuned for control values in the 0..1 range sampled at 15–30 Hz. */
export const DEFAULT_ONE_EURO_OPTIONS: OneEuroOptions = {
  minCutoffHz: 1,
  speedCoefficient: 3,
  derivativeCutoffHz: 1,
};

/** Smoothing factor of a first-order low-pass with the given cutoff over one step of `dtSec`. */
function smoothingFactor(cutoffHz: number, dtSec: number): number {
  const timeConstantSec = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + timeConstantSec / dtSec);
}

export class OneEuroFilter {
  private readonly options: OneEuroOptions;
  private previousValue: number | null = null;
  private previousSpeed = 0;
  private previousTimeMs = 0;

  constructor(options: OneEuroOptions = DEFAULT_ONE_EURO_OPTIONS) {
    this.options = options;
  }

  /**
   * Feeds one sample taken at `timestampMs` and returns the smoothed value. A sample whose
   * value or time is not a finite number is ignored (the previous output is returned, or the
   * sample itself if there is none yet): once inside the filter's state it would never leave.
   */
  filter(value: number, timestampMs: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(timestampMs)) {
      return this.previousValue ?? value;
    }
    if (this.previousValue === null) {
      this.previousValue = value;
      this.previousTimeMs = timestampMs;
      return value;
    }
    const dtSec = (timestampMs - this.previousTimeMs) / 1000;
    // A repeated or out-of-order timestamp carries no new time step to filter over.
    if (dtSec <= 0) return this.previousValue;

    const { minCutoffHz, speedCoefficient, derivativeCutoffHz } = this.options;
    const rawSpeed = (value - this.previousValue) / dtSec;
    const speed =
      this.previousSpeed +
      smoothingFactor(derivativeCutoffHz, dtSec) * (rawSpeed - this.previousSpeed);
    const cutoffHz = minCutoffHz + speedCoefficient * Math.abs(speed);
    const smoothed =
      this.previousValue + smoothingFactor(cutoffHz, dtSec) * (value - this.previousValue);

    this.previousValue = smoothed;
    this.previousSpeed = speed;
    this.previousTimeMs = timestampMs;
    return smoothed;
  }

  reset(): void {
    this.previousValue = null;
    this.previousSpeed = 0;
    this.previousTimeMs = 0;
  }
}
