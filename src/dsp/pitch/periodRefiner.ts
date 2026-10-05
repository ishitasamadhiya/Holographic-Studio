import { parabolicPeakOffset, parabolicPeakValue } from '../math';

/** Lags searched on each side of the coarse period, as a fraction of it (±5% ≈ ±85 cents). */
const SEARCH_FRACTION = 0.05;
const MIN_SEARCH_RADIUS = 3;

/** The comparison window is one period, but never shorter than this (noise robustness). */
const MIN_WINDOW_SEC = 0.004;

/** Long windows are subsampled down to roughly this many products per lag to bound the cost. */
const TARGET_TERMS = 128;

const ENERGY_FLOOR = 1e-12;

/**
 * Second stage of the pitch detector: measures the period on the newest samples only, at the
 * full sample rate.
 *
 * The first stage proposes candidate periods from a long window of the decimated signal, so
 * its answers are some 15 ms old and only as fine as the decimated rate allows. This stage
 * compares just the last period of signal with the one before it, over a few lags around
 * a candidate. That makes the result both precise (a fraction of a cent on clean tones) and
 * fresh (centred one period back), which is what lets a fast correction cancel vibrato
 * instead of chasing it. Its clarity is also what the detector uses to tell the true period
 * from its multiples and from strong harmonics.
 *
 * Cost: at most (2·radius + 1) · ~2·TARGET_TERMS multiply-adds.
 */
export class PeriodRefiner {
  /** Refined period in samples (fractional). */
  period = 0;
  /** Normalized correlation of the last two periods, 0..1. */
  clarity = 0;
  /** How many samples behind the newest one `refine` may read. */
  readonly requiredHistory: number = 0;

  private readonly minWindow: number = 0;
  private readonly scores: Float32Array;

  constructor(sampleRate: number, maxPeriodSamples: number) {
    this.minWindow = Math.round(MIN_WINDOW_SEC * sampleRate);
    const maxRadius = Math.max(MIN_SEARCH_RADIUS, Math.ceil(SEARCH_FRACTION * maxPeriodSamples));
    const maxLag = Math.ceil(maxPeriodSamples) + maxRadius + 1;
    this.scores = new Float32Array(2 * maxRadius + 3);
    this.requiredHistory = Math.max(maxLag, this.minWindow) + maxLag + 2;
  }

  /**
   * Searches around `coarsePeriod`, a whole number of samples. `data[newestIndex]` is the
   * most recent sample and at least `requiredHistory` earlier samples must be readable
   * behind it.
   */
  refine(data: Float32Array, newestIndex: number, coarsePeriod: number): void {
    const center = coarsePeriod;
    const radius = Math.min(
      (this.scores.length - 3) >> 1,
      Math.max(MIN_SEARCH_RADIUS, Math.ceil(SEARCH_FRACTION * center)),
    );
    const firstLag = Math.max(2, center - radius);
    const lagCount = center + radius - firstLag + 1;
    const windowLength = Math.max(center, this.minWindow);
    // Every product (x[n]·x[n−lag]) is individually maximized at the true period, so using
    // only every `stride`-th one loses noise averaging but does not bias the result.
    const stride = Math.max(1, Math.floor(windowLength / TARGET_TERMS));
    const terms = Math.floor(windowLength / stride);

    let energy = 0;
    for (let k = 0, index = newestIndex; k < terms; k++, index -= stride) {
      energy += data[index]! * data[index]!;
    }

    const scores = this.scores;
    let best = 0;
    let bestScore = -Infinity;
    for (let n = 0; n < lagCount; n++) {
      const lag = firstLag + n;
      let correlation = 0;
      let laggedEnergy = 0;
      for (let k = 0, index = newestIndex; k < terms; k++, index -= stride) {
        const lagged = data[index - lag]!;
        correlation += data[index]! * lagged;
        laggedEnergy += lagged * lagged;
      }
      const normalizer = energy + laggedEnergy;
      const score = normalizer > ENERGY_FLOOR ? (2 * correlation) / normalizer : 0;
      scores[n] = score;
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }

    if (best > 0 && best < lagCount - 1) {
      const left = scores[best - 1]!;
      const right = scores[best + 1]!;
      const offset = parabolicPeakOffset(left, bestScore, right);
      this.period = firstLag + best + offset;
      this.clarity = Math.min(1, parabolicPeakValue(left, bestScore, right, offset));
    } else {
      // The best match is at the edge of the search range: the pitch is moving faster than
      // the coarse estimate can follow. The edge is still closer to the truth than the centre.
      this.period = firstLag + best;
      this.clarity = Math.min(1, Math.max(0, bestScore));
    }
  }
}
