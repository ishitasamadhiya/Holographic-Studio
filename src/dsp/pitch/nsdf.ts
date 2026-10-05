// McLeod Pitch Method (MPM): the normalized square difference function and its lobes.
// P. McLeod, G. Wyvill, "A Smarter Way to Find Pitch", ICMC 2005.
import { parabolicPeakOffset, parabolicPeakValue } from '../math';

const ENERGY_FLOOR = 1e-12;

/**
 * Writes the NSDF of `samples[offset .. offset + length)` for lags 0..maxLag into `out`.
 *
 *   nsdf(τ) = 2·Σ x[j]·x[j+τ] / Σ (x[j]² + x[j+τ]²)      over j = 0 .. length-1-τ
 *
 * It is +1 where the signal repeats exactly, whatever its amplitude envelope, which is what
 * makes it usable as a "clarity" (voicing) measure.
 */
export function computeNsdf(
  samples: Float32Array,
  offset: number,
  length: number,
  maxLag: number,
  out: Float32Array,
): void {
  let energy = 0;
  for (let j = 0; j < length; j++) {
    const sample = samples[offset + j]!;
    energy += sample * sample;
  }
  // The denominator shrinks by the two samples that leave the sums at each lag.
  let normalizer = 2 * energy;
  out[0] = energy > ENERGY_FLOOR ? 1 : 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    const head = samples[offset + lag - 1]!;
    const tail = samples[offset + length - lag]!;
    normalizer -= head * head + tail * tail;
    let correlation = 0;
    const end = offset + length - lag;
    for (let j = offset; j < end; j++) correlation += samples[j]! * samples[j + lag]!;
    out[lag] = normalizer > ENERGY_FLOOR ? (2 * correlation) / normalizer : 0;
  }
}

/**
 * The positive lobes of an NSDF — MPM's "key maxima". Each one is a candidate for the pitch
 * period: the true period, one of its multiples, or (lower) a strong harmonic.
 */
export class NsdfPeaks {
  /** Number of lobes found by the last `find`, in order of increasing lag. */
  count = 0;
  /** Index of the highest lobe; meaningless when `count` is 0. */
  highestIndex = 0;

  private readonly lags: Float32Array;
  private readonly heights: Float32Array;

  constructor(maxLag: number) {
    // Lobes are separated by negative regions, so there can be at most one per two lags.
    const capacity = (maxLag >> 1) + 2;
    this.lags = new Float32Array(capacity);
    this.heights = new Float32Array(capacity);
  }

  /** Position of the top of lobe `index`, in (fractional) lags. */
  lag(index: number): number {
    return this.lags[index]!;
  }

  /** Height of lobe `index`: how well the signal matches itself at that lag (up to 1). */
  height(index: number): number {
    return this.heights[index]!;
  }

  /**
   * Collects the lobes whose top lies in minLag..maxLag. `nsdf` must be valid up to
   * maxLag + 1. Tops are located and measured by parabolic interpolation: the true top can
   * sit almost half a sample from the highest sampled value, and a narrow lobe loses a lot
   * of height over that distance.
   */
  find(nsdf: Float32Array, minLag: number, maxLag: number): void {
    let count = 0;
    let highestIndex = 0;

    let lag = 1;
    // The lobe around lag 0 is the signal matching itself, not a period.
    while (lag <= maxLag && nsdf[lag]! > 0) lag++;
    while (lag <= maxLag) {
      if (nsdf[lag]! <= 0) {
        lag++;
        continue;
      }
      let peakLag = lag;
      let peakValue = nsdf[lag]!;
      while (lag <= maxLag && nsdf[lag]! > 0) {
        if (nsdf[lag]! > peakValue) {
          peakValue = nsdf[lag]!;
          peakLag = lag;
        }
        lag++;
      }
      // A lobe that is still rising at the end of the range has no measurable top.
      const hasTop = peakLag < maxLag || nsdf[maxLag + 1]! < peakValue;
      if (peakLag >= minLag && hasTop && count < this.lags.length) {
        const left = nsdf[peakLag - 1]!;
        const right = nsdf[peakLag + 1]!;
        const offset = parabolicPeakOffset(left, peakValue, right);
        this.lags[count] = peakLag + offset;
        this.heights[count] = Math.min(1, parabolicPeakValue(left, peakValue, right, offset));
        if (this.heights[count]! > this.heights[highestIndex]! || count === 0) highestIndex = count;
        count++;
      }
    }
    this.count = count;
    this.highestIndex = highestIndex;
  }

  /**
   * MPM's choice: the first lobe that reaches `fraction` of the highest one. Later lobes of
   * similar height are multiples of that period. Requires `count` > 0.
   */
  firstReaching(fraction: number): number {
    const threshold = fraction * this.heights[this.highestIndex]!;
    let index = 0;
    while (this.heights[index]! < threshold) index++;
    return index;
  }

  /** Index of the lobe closest to `lag`, if one lies within `tolerance` (a fraction of `lag`); else -1. */
  nearest(lag: number, tolerance: number): number {
    let nearest = -1;
    let smallestDistance = tolerance * lag;
    for (let i = 0; i < this.count; i++) {
      const distance = Math.abs(this.lags[i]! - lag);
      if (distance <= smallestDistance) {
        smallestDistance = distance;
        nearest = i;
      }
    }
    return nearest;
  }
}
