// "How much of what is audible in the vocal band belongs to this one harmonic source?"
//
// Salience says which pitch is the most likely one in a frame, but not whether anybody is
// singing: a chord, a drum hit or a quiet reverb tail also has a "most salient" pitch. The
// voicing decision therefore uses an absolute measure: the share of the frame's vocal-band
// power (the whole mix, both channels) that sits on the harmonics of the candidate in the
// centre-emphasised spectrum. A lead vocal carries a large share; a chord splits its power
// over several notes, side-panned instruments are removed by the centre mask, and noise
// spreads evenly.
import { ANALYSIS_BAND_MAX_HZ, BAND_BIN_COUNT, createVocalBandWeights } from './centerSpectrum';
import {
  ANALYSIS_SAMPLE_RATE,
  BIN_HZ,
  FRAME_SIZE,
  MAX_HARMONICS,
  PITCH_BIN_COUNT,
  pitchBinToHz,
} from './frames';

/** Half-width of the Hann main lobe that holds ~99 % of a steady partial's energy. */
const PARTIAL_HALF_WIDTH_HZ = (1.25 * ANALYSIS_SAMPLE_RATE) / FRAME_SIZE;
/** Extra half-width proportional to frequency, for partials smeared by vibrato and glides. */
const PARTIAL_RELATIVE_HALF_WIDTH = 0.006;

export class HarmonicDominance {
  private readonly cumulative = new Float64Array(BAND_BIN_COUNT + 1);
  /** Flattened (pitch bin, harmonic) table of inclusive spectrum-bin ranges. */
  private readonly tableStart = new Int32Array(PITCH_BIN_COUNT + 1);
  private readonly rangeLow: Int32Array;
  private readonly rangeHigh: Int32Array;
  /** Share of a flat (noise) spectrum that the harmonic ranges of each pitch bin would catch. */
  private readonly chanceShare = new Float32Array(PITCH_BIN_COUNT);

  constructor() {
    const weights = createVocalBandWeights();
    let weightTotal = 0;
    for (let bin = 0; bin < BAND_BIN_COUNT; bin++) weightTotal += weights[bin]!;

    const lows: number[] = [];
    const highs: number[] = [];
    for (let pitchBin = 0; pitchBin < PITCH_BIN_COUNT; pitchBin++) {
      this.tableStart[pitchBin] = lows.length;
      const fundamentalHz = pitchBinToHz(pitchBin);
      let previousHigh = -1;
      let caught = 0;
      for (let harmonic = 1; harmonic <= MAX_HARMONICS; harmonic++) {
        const centerHz = harmonic * fundamentalHz;
        if (centerHz > ANALYSIS_BAND_MAX_HZ) break;
        const halfWidthHz = Math.max(PARTIAL_HALF_WIDTH_HZ, PARTIAL_RELATIVE_HALF_WIDTH * centerHz);
        const low = Math.max(previousHigh + 1, Math.ceil((centerHz - halfWidthHz) / BIN_HZ));
        const high = Math.min(BAND_BIN_COUNT - 1, Math.floor((centerHz + halfWidthHz) / BIN_HZ));
        if (high < low) continue;
        lows.push(low);
        highs.push(high);
        previousHigh = high;
        for (let bin = low; bin <= high; bin++) caught += weights[bin]!;
      }
      this.chanceShare[pitchBin] = caught / weightTotal;
    }
    this.tableStart[PITCH_BIN_COUNT] = lows.length;
    this.rangeLow = Int32Array.from(lows);
    this.rangeHigh = Int32Array.from(highs);
  }

  /** Call once per frame before `harmonicPower`. */
  setFrame(centerPower: Float32Array): void {
    const { cumulative } = this;
    let sum = 0;
    cumulative[0] = 0;
    for (let bin = 0; bin < BAND_BIN_COUNT; bin++) {
      sum += centerPower[bin]!;
      cumulative[bin + 1] = sum;
    }
  }

  /** Centre-emphasised power on the harmonics of the pitch at grid position `pitchBin`. */
  harmonicPower(pitchBin: number): number {
    const gridBin = this.nearestGridBin(pitchBin);
    const { cumulative, rangeLow, rangeHigh } = this;
    const end = this.tableStart[gridBin + 1]!;
    let power = 0;
    for (let entry = this.tableStart[gridBin]!; entry < end; entry++) {
      power += cumulative[rangeHigh[entry]! + 1]! - cumulative[rangeLow[entry]!]!;
    }
    return power;
  }

  /**
   * Share of the whole mix's vocal-band power (`mixPower`) explained by the candidate, beyond
   * what its harmonic ranges would catch by chance: the ranges of a low pitch cover a third of
   * the spectrum, so they collect a third of any noise that survives in the centre.
   * 0 = nothing but chance, 1 = everything audible in the band is this one source.
   */
  dominance(
    pitchBin: number,
    harmonicPower: number,
    centerPower: number,
    mixPower: number,
  ): number {
    if (mixPower <= 0) return 0;
    const chance = this.chanceShare[this.nearestGridBin(pitchBin)]!;
    const beyondChance = (harmonicPower - chance * Math.max(0, centerPower)) / (1 - chance);
    return Math.min(1, Math.max(0, beyondChance / mixPower));
  }

  private nearestGridBin(pitchBin: number): number {
    return Math.min(PITCH_BIN_COUNT - 1, Math.max(0, Math.round(pitchBin)));
  }
}
