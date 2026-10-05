// Harmonic-summation pitch salience: how strongly each candidate fundamental is supported by
// spectral energy at its harmonics.
import { ANALYSIS_BAND_MAX_HZ, BAND_BIN_COUNT } from './centerSpectrum';
import { BIN_HZ, MAX_HARMONICS, PITCH_BIN_COUNT, pitchBinToHz } from './frames';

/**
 * Harmonic h of a candidate fundamental f0 is weighted by (f0 + 27) / (h * f0 + 320), the
 * weighting of Klapuri's harmonic-summation estimator (ISMIR 2006). Two properties matter here:
 *  - The weight falls with the partial's frequency rather than its index, so a low voice (dozens
 *    of harmonics inside the band) and a high one (a handful) are treated alike.
 *  - For the same set of partials, the candidate an octave below the true pitch gets only about
 *    half the weight. Bass notes and chords constantly put energy at sub-octaves of the melody;
 *    this margin keeps them from winning. Candidates at 2*f0 or 3*f0 get more weight per
 *    partial but miss most partials.
 * The price: between f0 and 2*f0 it is the fundamental itself that tips the balance, so a tone
 * with NO energy at its fundamental reads an octave high. Voices rarely lose it completely,
 * and the tracker's register context catches the notes where it happens.
 */
const WEIGHT_NUMERATOR_OFFSET_HZ = 27;
const WEIGHT_DENOMINATOR_OFFSET_HZ = 320;

/**
 * Number of top salience peaks kept per frame as melody candidates. The right pitch is nearly
 * always among the first few; the tracker chooses between them using context.
 */
export const CANDIDATES_PER_FRAME = 5;

export class HarmonicSalience {
  /** Salience per pitch-grid bin for the most recent frame. */
  readonly salience = new Float32Array(PITCH_BIN_COUNT);

  private readonly compressed = new Float32Array(BAND_BIN_COUNT + 1);
  /** Flattened (pitch bin, harmonic) table: spectrum bin, interpolation fraction, weight. */
  private readonly tableStart = new Int32Array(PITCH_BIN_COUNT + 1);
  private readonly spectrumBin: Int32Array;
  private readonly fraction: Float32Array;
  private readonly weight: Float32Array;

  constructor() {
    const bins: number[] = [];
    const fractions: number[] = [];
    const weights: number[] = [];
    for (let pitchBin = 0; pitchBin < PITCH_BIN_COUNT; pitchBin++) {
      this.tableStart[pitchBin] = bins.length;
      const fundamentalHz = pitchBinToHz(pitchBin);
      for (let harmonic = 1; harmonic <= MAX_HARMONICS; harmonic++) {
        const partialHz = harmonic * fundamentalHz;
        if (partialHz > ANALYSIS_BAND_MAX_HZ) break;
        const position = partialHz / BIN_HZ;
        bins.push(Math.floor(position));
        fractions.push(position - Math.floor(position));
        weights.push(
          (fundamentalHz + WEIGHT_NUMERATOR_OFFSET_HZ) / (partialHz + WEIGHT_DENOMINATOR_OFFSET_HZ),
        );
      }
    }
    this.tableStart[PITCH_BIN_COUNT] = bins.length;
    this.spectrumBin = Int32Array.from(bins);
    this.fraction = Float32Array.from(fractions);
    this.weight = Float32Array.from(weights);
  }

  /**
   * Fills `salience` from a vocal-band weighted power spectrum (negative values, which the
   * centre estimate can contain, count as silence).
   */
  compute(power: Float32Array): void {
    const { compressed, salience, tableStart, spectrumBin, fraction, weight } = this;
    // Fourth root of power = square root of magnitude. Vocal harmonics differ by 20-30 dB
    // because of formants; without compression one loud partial would decide on its own.
    for (let bin = 0; bin < BAND_BIN_COUNT; bin++) {
      const value = power[bin]!;
      compressed[bin] = value > 0 ? Math.sqrt(Math.sqrt(value)) : 0;
    }
    for (let pitchBin = 0; pitchBin < PITCH_BIN_COUNT; pitchBin++) {
      const end = tableStart[pitchBin + 1]!;
      let sum = 0;
      for (let entry = tableStart[pitchBin]!; entry < end; entry++) {
        const bin = spectrumBin[entry]!;
        const low = compressed[bin]!;
        sum += weight[entry]! * (low + fraction[entry]! * (compressed[bin + 1]! - low));
      }
      salience[pitchBin] = sum;
    }
  }
}

export interface SaliencePeak {
  /** Fractional position on the pitch grid (parabolic interpolation between bins). */
  pitchBin: number;
  salience: number;
}

export function createSaliencePeaks(count: number): SaliencePeak[] {
  return Array.from({ length: count }, () => ({ pitchBin: 0, salience: 0 }));
}

/**
 * Finds the `peaks.length` strongest local maxima, strongest first. Unused slots get salience 0.
 * Returns the number of peaks found.
 */
export function pickSaliencePeaks(salience: Float32Array, peaks: SaliencePeak[]): number {
  let found = 0;
  for (let bin = 1; bin < salience.length - 1; bin++) {
    const value = salience[bin]!;
    const below = salience[bin - 1]!;
    const above = salience[bin + 1]!;
    if (!(value > below && value >= above)) continue;
    if (found === peaks.length && value <= peaks[found - 1]!.salience) continue;

    const curvature = below - 2 * value + above;
    const shift = curvature < 0 ? (0.5 * (below - above)) / curvature : 0;
    const refined = value - 0.25 * (below - above) * shift;

    // Insertion sort into the (short) list of best peaks.
    let slot = found < peaks.length ? found : found - 1;
    while (slot > 0 && peaks[slot - 1]!.salience < refined) {
      peaks[slot]!.pitchBin = peaks[slot - 1]!.pitchBin;
      peaks[slot]!.salience = peaks[slot - 1]!.salience;
      slot--;
    }
    peaks[slot]!.pitchBin = bin + shift;
    peaks[slot]!.salience = refined;
    if (found < peaks.length) found++;
  }
  for (let slot = found; slot < peaks.length; slot++) {
    peaks[slot]!.pitchBin = 0;
    peaks[slot]!.salience = 0;
  }
  return found;
}
