// First pass over the song: per frame, the strongest pitch candidates and how dominant each is.
import type { CenterSpectrumAnalyzer } from './centerSpectrum';
import { pitchBinToMidi } from './frames';
import { HarmonicDominance } from './harmonicDominance';
import { createMelodyCandidates, type MelodyCandidates } from './melodyTracker';
import {
  CANDIDATES_PER_FRAME,
  HarmonicSalience,
  createSaliencePeaks,
  pickSaliencePeaks,
} from './salience';

/**
 * Frames far quieter than the loud parts of the song cannot hold a usable lead vocal even if a
 * single source dominates them (fade-outs, reverb tails, codec noise). The dominance of a frame
 * is scaled down as its vocal-band power falls toward this fraction of the song's loud level.
 */
const QUIET_FRAME_FLOOR = 1e-3;
const LOUD_LEVEL_PERCENTILE = 0.9;

export interface FrameObserver {
  /** Called for every frame with the analyzer holding that frame's spectra. */
  (analyzer: CenterSpectrumAnalyzer, frameIndex: number): void;
}

export function extractMelodyCandidates(
  analyzer: CenterSpectrumAnalyzer,
  frameCount: number,
  observeFrame: FrameObserver,
): MelodyCandidates {
  const candidates = createMelodyCandidates(frameCount);
  const salience = new HarmonicSalience();
  const dominance = new HarmonicDominance();
  const peaks = createSaliencePeaks(CANDIDATES_PER_FRAME);
  const pitchBins = new Float32Array(frameCount * CANDIDATES_PER_FRAME);
  const harmonicPower = new Float32Array(frameCount * CANDIDATES_PER_FRAME);
  const centerPower = new Float32Array(frameCount);
  const mixPower = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    analyzer.analyzeFrame(frame);
    observeFrame(analyzer, frame);
    centerPower[frame] = analyzer.centerBandPower;
    mixPower[frame] = analyzer.mixBandPower;
    if (analyzer.centerBandPower <= 0) continue;

    salience.compute(analyzer.centerPower);
    const found = pickSaliencePeaks(salience.salience, peaks);
    dominance.setFrame(analyzer.centerPower);
    for (let slot = 0; slot < found; slot++) {
      const peak = peaks[slot]!;
      const index = frame * CANDIDATES_PER_FRAME + slot;
      pitchBins[index] = peak.pitchBin;
      candidates.pitchMidi[index] = pitchBinToMidi(peak.pitchBin);
      candidates.salience[index] = peak.salience;
      harmonicPower[index] = dominance.harmonicPower(peak.pitchBin);
    }
  }

  const floor = QUIET_FRAME_FLOOR * percentile(mixPower, LOUD_LEVEL_PERCENTILE);
  for (let frame = 0; frame < frameCount; frame++) {
    const denominator = mixPower[frame]! + floor;
    for (let slot = 0; slot < CANDIDATES_PER_FRAME; slot++) {
      const index = frame * CANDIDATES_PER_FRAME + slot;
      if (candidates.salience[index]! <= 0) continue;
      candidates.dominance[index] = dominance.dominance(
        pitchBins[index]!,
        harmonicPower[index]!,
        centerPower[frame]!,
        denominator,
      );
    }
  }
  return candidates;
}

function percentile(values: Float32Array, fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
}
