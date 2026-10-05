import { parabolicPeakOffset } from '../math';

/** Lags tried on each side of the nominal period, as a fraction of it. */
const SEARCH_FRACTION = 0.04;
const MIN_SEARCH_RADIUS = 2;

/** Below this similarity the signal is not periodic and no lag is better than any other. */
const MIN_SIMILARITY = 0.5;

const ENERGY_FLOOR = 1e-12;

/**
 * Finds how far the pitch shifter's read pointer has to jump so that the waveform it lands
 * on lines up with the waveform it leaves.
 *
 * The detector's period can be a fraction of a percent off, or a few milliseconds stale. A
 * jump by that length would cross-fade two slightly misaligned copies of the wave — a small
 * comb-filter "blip" on every splice. So the lags around the nominal period are compared
 * directly on the audio next to the read pointer, and the best-matching one (to a fraction of
 * a sample) is used instead.
 */
export class SpliceSearch {
  /** Best lag found by the last successful `find`, in samples (fractional). */
  lag = 0;

  private readonly scores: Float32Array;

  constructor(maxPeriodSamples: number) {
    this.scores = new Float32Array(2 * SpliceSearch.radiusFor(maxPeriodSamples) + 1);
  }

  /** Lags searched on each side of a period. */
  static radiusFor(periodSamples: number): number {
    return Math.max(MIN_SEARCH_RADIUS, Math.ceil(SEARCH_FRACTION * periodSamples));
  }

  /**
   * Compares the anchor segment `data[anchorStart .. anchorStart + windowLength)` (every
   * `stride`-th sample) with copies of itself displaced by `centerLag - radius` to
   * `centerLag + radius` samples: toward the past when `direction` is +1, toward the present
   * when it is -1.
   *
   * Returns true and sets `lag` when one of them matches; false when the signal there has no
   * usable periodicity (the caller then keeps its nominal period). The caller guarantees
   * every index touched is valid. All arguments are integers on purpose: this runs on the
   * audio thread, where passing fractional numbers between functions costs an allocation.
   */
  find(
    data: Float32Array,
    anchorStart: number,
    windowLength: number,
    stride: number,
    direction: 1 | -1,
    centerLag: number,
    radius: number,
  ): boolean {
    const reach = Math.min((this.scores.length - 1) >> 1, radius);
    const firstLag = Math.max(1, centerLag - reach);
    const lagCount = centerLag + reach - firstLag + 1;
    const anchorEnd = anchorStart + windowLength;

    let anchorEnergy = 0;
    for (let index = anchorStart; index < anchorEnd; index += stride) {
      anchorEnergy += data[index]! * data[index]!;
    }

    const scores = this.scores;
    let best = 0;
    let bestScore = -Infinity;
    for (let n = 0; n < lagCount; n++) {
      const displacement = -direction * (firstLag + n);
      let correlation = 0;
      let displacedEnergy = 0;
      for (let index = anchorStart; index < anchorEnd; index += stride) {
        const displaced = data[index + displacement]!;
        correlation += data[index]! * displaced;
        displacedEnergy += displaced * displaced;
      }
      // Normalizing by both energies also penalizes level differences, so the chosen
      // segment matches in loudness as well as in shape.
      const normalizer = anchorEnergy + displacedEnergy;
      const score = normalizer > ENERGY_FLOOR ? (2 * correlation) / normalizer : 0;
      scores[n] = score;
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }

    if (bestScore < MIN_SIMILARITY) return false;
    const offset =
      best > 0 && best < lagCount - 1
        ? parabolicPeakOffset(scores[best - 1]!, bestScore, scores[best + 1]!)
        : 0;
    this.lag = firstLag + best + offset;
    return true;
  }
}
