// Per-frame spectra of the reference song with the centre of the stereo image emphasised.
//
// Lead vocals are almost always mixed dead centre, i.e. identical in both channels, while pads,
// guitars, backing vocals and reverbs are spread to the sides. For each frequency bin the
// inter-channel cross power Re(L R*) equals |L|^2 for a centred source, is scaled down by
//
//     psi = 2 Re(L R*) / (|L|^2 + |R|^2)        (the inter-channel similarity)
//
// for an amplitude-panned one (psi = cos of the pan angle), and averages to zero for
// decorrelated "wide" content, whose phase difference is random. The centre estimate used here
// is the cross power, further attenuated by a power of |psi| to push partly panned instruments
// down. It is deliberately left signed: out-of-phase bins count negative, so that wide content
// cancels when summed over the harmonics of a pitch candidate instead of leaking in.
import { RealFft } from './fft';
import {
  ANALYSIS_SAMPLE_RATE,
  BIN_HZ,
  FFT_SIZE,
  FRAME_SIZE,
  HOP_SIZE,
  SPECTRUM_BIN_COUNT,
  hannWindow,
} from './frames';

/** Highest frequency used by the melody analysis; the resampler is alias-free up to here. */
export const ANALYSIS_BAND_MAX_HZ = 0.4 * ANALYSIS_SAMPLE_RATE;
/** Number of spectrum bins inside the analysis band. */
export const BAND_BIN_COUNT = Math.floor(ANALYSIS_BAND_MAX_HZ / BIN_HZ) + 1;

/**
 * Second-order high-pass corner of the "vocal band" weighting. Bass and kick drum carry most of
 * a mix's energy but none of the melody; a voice is still found from its harmonics above this.
 */
const VOCAL_BAND_LOW_HZ = 200;
/** The weighting fades out above this, toward the edge of the analysis band. */
const VOCAL_BAND_HIGH_HZ = 5000;

/**
 * psi is estimated from sums over +/- this many bins (about one main lobe of the zero-padded
 * window): single-bin estimates are very noisy.
 */
const SIMILARITY_SMOOTHING_BINS = 2;

function vocalBandWeight(frequencyHz: number): number {
  const ratio = (frequencyHz / VOCAL_BAND_LOW_HZ) ** 4;
  const highPass = ratio / (1 + ratio);
  const fade =
    frequencyHz <= VOCAL_BAND_HIGH_HZ
      ? 1
      : Math.max(
          0,
          (ANALYSIS_BAND_MAX_HZ - frequencyHz) / (ANALYSIS_BAND_MAX_HZ - VOCAL_BAND_HIGH_HZ),
        );
  return highPass * fade;
}

/** Power weighting of each bin that defines the "vocal band". */
export function createVocalBandWeights(): Float32Array {
  const weights = new Float32Array(BAND_BIN_COUNT);
  for (let bin = 0; bin < BAND_BIN_COUNT; bin++) weights[bin] = vocalBandWeight(bin * BIN_HZ);
  return weights;
}

/**
 * Computes one frame at a time (nothing is kept between frames), so a whole song never needs
 * more memory than its 16 kHz samples.
 */
export class CenterSpectrumAnalyzer {
  /**
   * Vocal-band-weighted power of the centre of the stereo image, per bin. Signed for stereo
   * material (see the file comment); equal to the weighted power spectrum for mono material.
   */
  readonly centerPower = new Float32Array(BAND_BIN_COUNT);
  /** Unweighted power of the plain mid signal (L+R)/2, per bin: the full mix. */
  readonly mixPower = new Float32Array(BAND_BIN_COUNT);
  /** Sum of `centerPower`. */
  centerBandPower = 0;
  /** Vocal-band-weighted power of everything in the frame (mean of both channels). */
  mixBandPower = 0;
  /** The part of `mixBandPower` that is in the side signal (L-R)/2; 0 for mono material. */
  sideBandPower = 0;

  private readonly fft = new RealFft(FFT_SIZE);
  private readonly window = hannWindow(FRAME_SIZE);
  private readonly frame = new Float64Array(FRAME_SIZE);
  private readonly leftRe = new Float64Array(SPECTRUM_BIN_COUNT);
  private readonly leftIm = new Float64Array(SPECTRUM_BIN_COUNT);
  private readonly rightRe = new Float64Array(SPECTRUM_BIN_COUNT);
  private readonly rightIm = new Float64Array(SPECTRUM_BIN_COUNT);
  private readonly crossPower = new Float64Array(BAND_BIN_COUNT);
  private readonly sumPower = new Float64Array(BAND_BIN_COUNT);
  private readonly bandWeights = createVocalBandWeights();

  /** `left` / `right` are at ANALYSIS_SAMPLE_RATE; `right` is null for mono material. */
  constructor(
    private readonly left: Float32Array,
    private readonly right: Float32Array | null,
  ) {}

  /** Analyses the frame centred on sample `frameIndex * HOP_SIZE`. */
  analyzeFrame(frameIndex: number): void {
    const { centerPower, mixPower, bandWeights, leftRe, leftIm } = this;
    this.transform(this.left, frameIndex, leftRe, leftIm);

    if (this.right === null) {
      let total = 0;
      for (let bin = 0; bin < BAND_BIN_COUNT; bin++) {
        const power = leftRe[bin]! * leftRe[bin]! + leftIm[bin]! * leftIm[bin]!;
        const weighted = power * bandWeights[bin]!;
        mixPower[bin] = power;
        centerPower[bin] = weighted;
        total += weighted;
      }
      this.centerBandPower = total;
      this.mixBandPower = total;
      this.sideBandPower = 0;
      return;
    }

    const { rightRe, rightIm, crossPower, sumPower } = this;
    this.transform(this.right, frameIndex, rightRe, rightIm);
    for (let bin = 0; bin < BAND_BIN_COUNT; bin++) {
      const lr = leftRe[bin]!;
      const li = leftIm[bin]!;
      const rr = rightRe[bin]!;
      const ri = rightIm[bin]!;
      crossPower[bin] = lr * rr + li * ri;
      sumPower[bin] = lr * lr + li * li + rr * rr + ri * ri;
    }

    let centerTotal = 0;
    let mixTotal = 0;
    let sideTotal = 0;
    let crossSum = 0;
    let powerSum = 0;
    for (let bin = 0; bin < SIMILARITY_SMOOTHING_BINS; bin++) {
      crossSum += crossPower[bin]!;
      powerSum += sumPower[bin]!;
    }
    for (let bin = 0; bin < BAND_BIN_COUNT; bin++) {
      const entering = bin + SIMILARITY_SMOOTHING_BINS;
      if (entering < BAND_BIN_COUNT) {
        crossSum += crossPower[entering]!;
        powerSum += sumPower[entering]!;
      }
      const leaving = bin - SIMILARITY_SMOOTHING_BINS - 1;
      if (leaving >= 0) {
        crossSum -= crossPower[leaving]!;
        powerSum -= sumPower[leaving]!;
      }
      const similarity = powerSum > 0 ? Math.min(1, Math.abs((2 * crossSum) / powerSum)) : 0;
      // |psi|^5 on top of the cross power's own factor psi: an instrument panned 60 % to one
      // side (psi = 0.59) ends up 14 dB down, a voice with a stereo reverb on it (psi around
      // 0.9) loses less than 3 dB.
      const squared = similarity * similarity;
      const gain = squared * squared * similarity;
      const weight = bandWeights[bin]!;
      const cross = crossPower[bin]!;
      const sum = sumPower[bin]!;
      const center = cross * gain * weight;
      mixPower[bin] = 0.25 * sum + 0.5 * cross;
      centerPower[bin] = center;
      centerTotal += center;
      mixTotal += 0.5 * sum * weight;
      sideTotal += (0.25 * sum - 0.5 * cross) * weight;
    }
    this.centerBandPower = centerTotal;
    this.mixBandPower = mixTotal;
    this.sideBandPower = sideTotal;
  }

  private transform(
    signal: Float32Array,
    frameIndex: number,
    outRe: Float64Array,
    outIm: Float64Array,
  ): void {
    const { frame, window } = this;
    const start = frameIndex * HOP_SIZE - FRAME_SIZE / 2;
    for (let index = 0; index < FRAME_SIZE; index++) {
      const position = start + index;
      frame[index] =
        position >= 0 && position < signal.length ? signal[position]! * window[index]! : 0;
    }
    this.fft.forward(frame, outRe, outIm);
  }
}
