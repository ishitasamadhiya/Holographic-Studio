// Radix-2 FFT for real signals with all tables and scratch buffers allocated once.
//
// A length-N real transform is computed with one length-N/2 complex transform: even samples go
// into the real part and odd samples into the imaginary part, and the two interleaved
// half-spectra are separated afterwards. That halves the work of the analysis' inner loop.

export function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

export function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

/** In-place complex FFT of a fixed power-of-two size. */
class ComplexFft {
  private readonly bitReversed: Uint32Array;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;

  constructor(private readonly size: number) {
    this.bitReversed = new Uint32Array(size);
    const bits = Math.round(Math.log2(size));
    for (let index = 0; index < size; index++) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit++) {
        if (index & (1 << bit)) reversed |= 1 << (bits - 1 - bit);
      }
      this.bitReversed[index] = reversed;
    }
    const half = size >> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let index = 0; index < half; index++) {
      const angle = (2 * Math.PI * index) / size;
      this.cosTable[index] = Math.cos(angle);
      this.sinTable[index] = Math.sin(angle);
    }
  }

  /** Forward transform (e^-jwt kernel), unnormalized. */
  transform(re: Float64Array, im: Float64Array): void {
    const { size, bitReversed, cosTable, sinTable } = this;
    for (let index = 0; index < size; index++) {
      const swapIndex = bitReversed[index]!;
      if (swapIndex > index) {
        const tempRe = re[index]!;
        re[index] = re[swapIndex]!;
        re[swapIndex] = tempRe;
        const tempIm = im[index]!;
        im[index] = im[swapIndex]!;
        im[swapIndex] = tempIm;
      }
    }
    for (let span = 1; span < size; span <<= 1) {
      const tableStep = size / (span << 1);
      for (let start = 0; start < size; start += span << 1) {
        for (let offset = 0; offset < span; offset++) {
          const wr = cosTable[offset * tableStep]!;
          const wi = -sinTable[offset * tableStep]!;
          const upper = start + offset;
          const lower = upper + span;
          const lowerRe = re[lower]!;
          const lowerIm = im[lower]!;
          const tr = lowerRe * wr - lowerIm * wi;
          const ti = lowerRe * wi + lowerIm * wr;
          const upperRe = re[upper]!;
          const upperIm = im[upper]!;
          re[lower] = upperRe - tr;
          im[lower] = upperIm - ti;
          re[upper] = upperRe + tr;
          im[upper] = upperIm + ti;
        }
      }
    }
  }
}

/**
 * Real-input FFT of a fixed power-of-two size N. Spectra are "half spectra": bins 0..N/2
 * (N/2 + 1 values); the remaining bins are their complex conjugates.
 */
export class RealFft {
  readonly size: number;
  /** Number of bins in a half spectrum: size / 2 + 1. */
  readonly binCount: number;

  private readonly half: number;
  private readonly complexFft: ComplexFft;
  private readonly workRe: Float64Array;
  private readonly workIm: Float64Array;
  /** cos/sin of 2*pi*k/N for k = 0..N/2, the phase between the even and odd sample grids. */
  private readonly twistCos: Float64Array;
  private readonly twistSin: Float64Array;

  constructor(size: number) {
    if (!isPowerOfTwo(size) || size < 4) {
      throw new RangeError(`FFT size must be a power of two >= 4, got ${size}`);
    }
    this.size = size;
    this.half = size >> 1;
    this.binCount = this.half + 1;
    this.complexFft = new ComplexFft(this.half);
    this.workRe = new Float64Array(this.half);
    this.workIm = new Float64Array(this.half);
    this.twistCos = new Float64Array(this.half + 1);
    this.twistSin = new Float64Array(this.half + 1);
    for (let bin = 0; bin <= this.half; bin++) {
      const angle = (2 * Math.PI * bin) / size;
      this.twistCos[bin] = Math.cos(angle);
      this.twistSin[bin] = Math.sin(angle);
    }
  }

  /**
   * Forward transform. `input` may be shorter than the FFT size (it is zero-padded).
   * Writes bins 0..N/2 into `outRe` / `outIm`.
   */
  forward(input: ArrayLike<number>, outRe: Float64Array, outIm: Float64Array): void {
    const { half, workRe, workIm, twistCos, twistSin } = this;
    const inputLength = Math.min(input.length, this.size);
    for (let index = 0; index < half; index++) {
      const even = 2 * index;
      workRe[index] = even < inputLength ? input[even]! : 0;
      workIm[index] = even + 1 < inputLength ? input[even + 1]! : 0;
    }
    this.complexFft.transform(workRe, workIm);

    // With Z = FFT(even + j*odd):  E[k] = (Z[k] + conj(Z[M-k])) / 2,  O[k] = (Z[k] - conj(Z[M-k])) / 2j
    // and X[k] = E[k] + e^(-2*pi*j*k/N) * O[k].
    for (let bin = 0; bin <= half; bin++) {
      const index = bin === half ? 0 : bin;
      const mirror = bin === 0 ? 0 : half - bin;
      const zr = workRe[index]!;
      const zi = workIm[index]!;
      const mr = workRe[mirror]!;
      const mi = workIm[mirror]!;
      const evenRe = 0.5 * (zr + mr);
      const evenIm = 0.5 * (zi - mi);
      const oddRe = 0.5 * (zi + mi);
      const oddIm = -0.5 * (zr - mr);
      const cos = twistCos[bin]!;
      const sin = twistSin[bin]!;
      outRe[bin] = evenRe + oddRe * cos + oddIm * sin;
      outIm[bin] = evenIm + oddIm * cos - oddRe * sin;
    }
  }

  /**
   * Inverse transform of a half spectrum (bins 0..N/2) back to N real samples.
   * Includes the 1/N normalization, so inverse(forward(x)) = x.
   */
  inverse(re: Float64Array, im: Float64Array, output: Float64Array): void {
    const { half, workRe, workIm, twistCos, twistSin } = this;
    // Rebuild Z[k] = E[k] + j*O[k] from the half spectrum using X[k + N/2] = conj(X[N/2 - k]).
    for (let bin = 0; bin < half; bin++) {
      const mirror = half - bin;
      const xr = re[bin]!;
      const xi = im[bin]!;
      const mr = re[mirror]!;
      const mi = -im[mirror]!;
      const evenRe = 0.5 * (xr + mr);
      const evenIm = 0.5 * (xi + mi);
      const diffRe = 0.5 * (xr - mr);
      const diffIm = 0.5 * (xi - mi);
      const cos = twistCos[bin]!;
      const sin = twistSin[bin]!;
      const oddRe = diffRe * cos - diffIm * sin;
      const oddIm = diffRe * sin + diffIm * cos;
      // The inverse complex transform is done as conj(FFT(conj(Z))), hence the sign flip here.
      workRe[bin] = evenRe - oddIm;
      workIm[bin] = -(evenIm + oddRe);
    }
    this.complexFft.transform(workRe, workIm);
    const scale = 1 / half;
    for (let index = 0; index < half; index++) {
      output[2 * index] = workRe[index]! * scale;
      output[2 * index + 1] = -workIm[index]! * scale;
    }
  }
}
