// The reference-song analysis pipeline: PCM in, ReferenceAnalysis out.
import {
  REFERENCE_ANALYSIS_SCHEMA_VERSION,
  midiToHz,
  type MelodyNote,
  type ReferenceAnalysis,
} from '@shared/music';
import { CenterSpectrumAnalyzer } from './centerSpectrum';
import { MixChroma } from './chroma';
import { cleanContour } from './contourCleanup';
import { ANALYSIS_SAMPLE_RATE, HOP_SEC, frameCountFor } from './frames';
import { estimateKey, melodyPitchClassProfile } from './keyEstimation';
import { extractMelodyCandidates } from './melodyCandidates';
import { trackMelody, type TrackedMelody } from './melodyTracker';
import { segmentNotes } from './noteSegmentation';
import { gradeMelody, measureNoteStability } from './quality';
import { assertValidSampleRate, limitImplausibleLevel, prepareChannel } from './pcm';
import { voicingThresholdFor } from './stereoImage';
import { TuningEvidence, combineTuning } from './tuning';
import type { StereoPcm } from './types';
import { keepVoiceLikePhrases } from './voiceLikeness';

export interface AnalyzeOptions {
  /** Called regularly with the fraction of work done, 0..1 (monotonic, ends at 1). */
  onProgress?: (fraction: number) => void;
}

/** Harmonic dominance that maps to full confidence: a lead as loud as everything else. */
const FULL_CONFIDENCE_DOMINANCE = 0.5;
/** Chroma needs no finer time resolution than this many frames (20 ms). */
const CHROMA_FRAME_STRIDE = 2;
const PROGRESS_FRAME_STRIDE = 64;
/**
 * Frames moving faster than this (semitones per frame) are glides or vibrato swings and say
 * little about which grid the singer is aiming at; they are left out of the tuning estimate.
 */
const TUNING_MAX_MOVEMENT = 0.15;

/**
 * Say of the melody's note histogram in the key estimate, relative to the mix's chroma. The
 * chroma hears the chords and the bass for the whole song; the melody is a few hundred notes
 * at best and may contain transcription errors, so it only gets a minor vote.
 */
const MELODY_KEY_WEIGHT = 0.3;

// Shares of the total running time, for progress reporting.
const PROGRESS_AFTER_RESAMPLING = 0.15;
const PROGRESS_AFTER_FRAMES = 0.95;

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/** Both channels at the analysis rate, trimmed to a common length. */
function prepareChannels(
  pcm: StereoPcm,
  onStep: () => void,
): { left: Float32Array; right: Float32Array | null } {
  const { sampleRate } = pcm;
  if (pcm.right === null) {
    const left = prepareChannel(pcm.left, sampleRate, ANALYSIS_SAMPLE_RATE);
    onStep();
    onStep();
    limitImplausibleLevel([left]);
    return { left, right: null };
  }
  const length = Math.min(pcm.left.length, pcm.right.length);
  const left = prepareChannel(pcm.left.subarray(0, length), sampleRate, ANALYSIS_SAMPLE_RATE);
  onStep();
  const right = prepareChannel(pcm.right.subarray(0, length), sampleRate, ANALYSIS_SAMPLE_RATE);
  onStep();
  limitImplausibleLevel([left, right]);
  return { left, right };
}

function melodyTuningEvidence(melody: TrackedMelody): TuningEvidence {
  const evidence = new TuningEvidence();
  const { pitchMidi, dominance } = melody;
  for (let frame = 1; frame < pitchMidi.length - 1; frame++) {
    const pitch = pitchMidi[frame]!;
    const steady =
      Math.abs(pitch - pitchMidi[frame - 1]!) <= TUNING_MAX_MOVEMENT &&
      Math.abs(pitchMidi[frame + 1]! - pitch) <= TUNING_MAX_MOVEMENT;
    // Comparisons with NaN (unvoiced neighbours) are false, so run edges are skipped too.
    if (steady) evidence.add(pitch, dominance[frame]!);
  }
  return evidence;
}

/**
 * Analyses the original song (full mix with vocals): lead-melody contour, notes, key, tuning
 * and a quality grade. CPU-bound and synchronous; meant to run in a worker.
 */
export function analyzeReference(pcm: StereoPcm, options: AnalyzeOptions = {}): ReferenceAnalysis {
  assertValidSampleRate(pcm);
  let reported = 0;
  const report = (fraction: number) => {
    reported = Math.max(reported, Math.min(1, fraction));
    options.onProgress?.(reported);
  };
  report(0);

  const sampleCount = pcm.right ? Math.min(pcm.left.length, pcm.right.length) : pcm.left.length;
  const durationSec = sampleCount / pcm.sampleRate;
  let resampleSteps = 0;
  const { left, right } = prepareChannels(pcm, () => {
    resampleSteps++;
    report((PROGRESS_AFTER_RESAMPLING * resampleSteps) / 2);
  });
  const frameCount = frameCountFor(left.length);

  // Pass over the frames: melody candidates, plus the mix's chroma and tuning on the side.
  const chroma = new MixChroma();
  const analyzer = new CenterSpectrumAnalyzer(left, right);
  let mixPower = 0;
  let sidePower = 0;
  const candidates = extractMelodyCandidates(analyzer, frameCount, (frameAnalyzer, frame) => {
    mixPower += frameAnalyzer.mixBandPower;
    sidePower += frameAnalyzer.sideBandPower;
    if (frame % CHROMA_FRAME_STRIDE === 0) chroma.addFrame(frameAnalyzer.mixPower);
    if (frame % PROGRESS_FRAME_STRIDE === 0) {
      const done = frame / frameCount;
      report(
        PROGRESS_AFTER_RESAMPLING + (PROGRESS_AFTER_FRAMES - PROGRESS_AFTER_RESAMPLING) * done,
      );
    }
  });
  report(PROGRESS_AFTER_FRAMES);

  const stereoWidth = mixPower > 0 ? sidePower / mixPower : 0;
  const voicingThreshold = voicingThresholdFor(stereoWidth);
  const melody = trackMelody(candidates, HOP_SEC, voicingThreshold);
  cleanContour(melody, voicingThreshold);
  const likeness = keepVoiceLikePhrases(melody);

  const tuningCents = combineTuning([chroma.tuning, melodyTuningEvidence(melody)]);

  const f0Hz = new Array<number>(frameCount);
  const confidence = new Array<number>(frameCount);
  const tunedPitch = new Float32Array(frameCount);
  let voicedFrames = 0;
  let confidenceSum = 0;
  for (let frame = 0; frame < frameCount; frame++) {
    const pitch = melody.pitchMidi[frame]!;
    if (Number.isNaN(pitch)) {
      f0Hz[frame] = 0;
      confidence[frame] = 0;
      tunedPitch[frame] = Number.NaN;
      continue;
    }
    const frameConfidence = Math.min(1, melody.dominance[frame]! / FULL_CONFIDENCE_DOMINANCE);
    f0Hz[frame] = roundTo(midiToHz(pitch), 2);
    confidence[frame] = roundTo(frameConfidence, 3);
    tunedPitch[frame] = pitch - tuningCents / 100;
    voicedFrames++;
    confidenceSum += frameConfidence;
  }

  const notes: MelodyNote[] = segmentNotes(tunedPitch, confidence, HOP_SEC).map((note) => ({
    startSec: roundTo(note.startSec, 3),
    endSec: roundTo(note.endSec, 3),
    midi: note.midi,
    confidence: roundTo(note.confidence, 3),
  }));

  const voicedRatio = frameCount > 0 ? voicedFrames / frameCount : 0;
  const meanConfidence = voicedFrames > 0 ? confidenceSum / voicedFrames : 0;
  const trackedFrames = likeness.rejectedFrames + likeness.keptFrames;
  const quality = gradeMelody({
    instrumentShare: trackedFrames > 0 ? likeness.rejectedFrames / trackedFrames : 0,
    voicedRatio,
    meanConfidence,
    notesPerMinute: durationSec > 0 ? notes.length / (durationSec / 60) : 0,
    noteStability: measureNoteStability(tunedPitch, notes, HOP_SEC),
  });

  // A melody that is not trusted must not colour the key either; the mix's chroma stands alone.
  const keyEvidence = [{ profile: chroma.pitchClassProfile(tuningCents), weight: 1 }];
  if (quality !== 'poor') {
    keyEvidence.push({ profile: melodyPitchClassProfile(notes), weight: MELODY_KEY_WEIGHT });
  }
  const key = estimateKey(keyEvidence);

  report(1);
  return {
    schemaVersion: REFERENCE_ANALYSIS_SCHEMA_VERSION,
    durationSec,
    contour: { hopSec: HOP_SEC, f0Hz, confidence },
    notes,
    key: { tonic: key.tonic, mode: key.mode, confidence: roundTo(key.confidence, 3) },
    tuningCents: roundTo(tuningCents, 1),
    quality,
    stats: {
      voicedRatio: roundTo(voicedRatio, 4),
      meanConfidence: roundTo(meanConfidence, 4),
      noteCount: notes.length,
    },
  };
}
