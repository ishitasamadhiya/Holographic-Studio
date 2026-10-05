// Pitch-class content of the full mix, gathered from spectral peaks: the harmonic backdrop
// (chords, bass) that the key estimate and the tuning estimate are based on.
import { hzToMidi } from '@shared/music';
import { BIN_HZ } from './frames';
import { TuningEvidence } from './tuning';

/** C2..C7: where chords and bass lines live. */
const CHROMA_MIN_HZ = 65;
const CHROMA_MAX_HZ = 2100;
/**
 * Peaks below this are too coarsely resolved (and too crowded by bass and kick drum) to say
 * anything about tuning to within a few cents.
 */
const TUNING_MIN_HZ = 200;
/** Peaks more than 30 dB below the frame's strongest are ignored. */
const PEAK_FLOOR = 1e-3;
/** Resolution of the accumulated histogram: the tuning is only known after the whole pass. */
const BINS_PER_SEMITONE = 10;
const HISTOGRAM_SIZE = 12 * BINS_PER_SEMITONE;

export class MixChroma {
  /** Deviation of the mix's spectral peaks from the A = 440 Hz grid. */
  readonly tuning = new TuningEvidence();

  private readonly histogram = new Float64Array(HISTOGRAM_SIZE);
  private readonly firstBin = Math.max(1, Math.ceil(CHROMA_MIN_HZ / BIN_HZ));
  private readonly lastBin = Math.floor(CHROMA_MAX_HZ / BIN_HZ);

  /** Adds the spectral peaks of one frame's power spectrum (bins of width BIN_HZ). */
  addFrame(power: Float32Array): void {
    const { firstBin, histogram } = this;
    const lastBin = Math.min(this.lastBin, power.length - 2);
    let strongest = 0;
    for (let bin = firstBin; bin <= lastBin; bin++) {
      if (power[bin]! > strongest) strongest = power[bin]!;
    }
    if (strongest <= 0) return;
    const floor = strongest * PEAK_FLOOR;

    for (let bin = firstBin; bin <= lastBin; bin++) {
      const center = power[bin]!;
      const below = power[bin - 1]!;
      const above = power[bin + 1]!;
      if (center < floor || !(center > below && center >= above) || below <= 0 || above <= 0) {
        continue;
      }
      // Parabola through the log powers: accurate to a small fraction of a bin for the
      // (near-Gaussian) main lobe of a Hann window.
      const logBelow = Math.log(below);
      const logCenter = Math.log(center);
      const logAbove = Math.log(above);
      const shift = (0.5 * (logBelow - logAbove)) / (logBelow - 2 * logCenter + logAbove);
      const frequency = (bin + shift) * BIN_HZ;
      const midi = hzToMidi(frequency);
      const amplitude = Math.sqrt(center);

      const position = Math.round(midi * BINS_PER_SEMITONE);
      histogram[((position % HISTOGRAM_SIZE) + HISTOGRAM_SIZE) % HISTOGRAM_SIZE]! += amplitude;
      if (frequency >= TUNING_MIN_HZ) this.tuning.add(midi, amplitude);
    }
  }

  /** Twelve pitch-class weights (index 0 = C) on a grid shifted by the song's tuning. */
  pitchClassProfile(tuningCents: number): number[] {
    const profile = new Array<number>(12).fill(0);
    const shift = (tuningCents / 100) * BINS_PER_SEMITONE;
    for (let index = 0; index < HISTOGRAM_SIZE; index++) {
      const pitchClass = Math.round((index - shift) / BINS_PER_SEMITONE);
      profile[((pitchClass % 12) + 12) % 12]! += this.histogram[index]!;
    }
    return profile;
  }
}
