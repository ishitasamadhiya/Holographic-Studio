// Scoring helpers for the synthetic-song tests (the usual melody-extraction measures).
import type { MelodyNote } from '@shared/music';
import type { SongTruth, TruthNote } from './renderSong';

export interface MelodyScores {
  /** Share of truly sung frames that were found AND are within 50 cents of the sung pitch. */
  rawPitchAccuracy: number;
  /** Same, but ignoring the octave. The gap to rawPitchAccuracy is the octave-error rate. */
  rawChromaAccuracy: number;
  /** Share of truly sung frames that were marked as sung. */
  voicingRecall: number;
  /** Share of frames without singing that were wrongly marked as sung. */
  voicingFalseAlarm: number;
  /** Mean signed pitch error in cents over the correctly pitched frames (estimator bias). */
  meanErrorCents: number;
}

function centsBetween(estimateHz: number, truthHz: number): number {
  return 1200 * Math.log2(estimateHz / truthHz);
}

export function scoreMelody(
  truth: SongTruth,
  estimateF0Hz: ArrayLike<number>,
  estimateHopSec: number,
): MelodyScores {
  let sungFrames = 0;
  let silentFrames = 0;
  let pitchCorrect = 0;
  let chromaCorrect = 0;
  let detected = 0;
  let falseAlarms = 0;
  let errorSum = 0;

  for (let frame = 0; frame < truth.f0Hz.length; frame++) {
    const truthHz = truth.f0Hz[frame]!;
    const estimateIndex = Math.round((frame * truth.hopSec) / estimateHopSec);
    const estimateHz = estimateF0Hz[estimateIndex] ?? 0;
    if (truthHz > 0) {
      sungFrames++;
      if (estimateHz <= 0) continue;
      detected++;
      const error = centsBetween(estimateHz, truthHz);
      if (Math.abs(error) <= 50) {
        pitchCorrect++;
        errorSum += error;
      }
      const folded = error - 1200 * Math.round(error / 1200);
      if (Math.abs(folded) <= 50) chromaCorrect++;
    } else {
      silentFrames++;
      if (estimateHz > 0) falseAlarms++;
    }
  }

  const ratio = (count: number, total: number) => (total > 0 ? count / total : 0);
  return {
    rawPitchAccuracy: ratio(pitchCorrect, sungFrames),
    rawChromaAccuracy: ratio(chromaCorrect, sungFrames),
    voicingRecall: ratio(detected, sungFrames),
    voicingFalseAlarm: ratio(falseAlarms, silentFrames),
    meanErrorCents: pitchCorrect > 0 ? errorSum / pitchCorrect : 0,
  };
}

export interface NoteScores {
  /** Share of true notes that were found with the right MIDI number and onset. */
  recall: number;
  /** Share of reported notes that correspond to a true note. */
  precision: number;
  matched: number;
}

export function scoreNotes(
  truthNotes: readonly TruthNote[],
  estimatedNotes: readonly MelodyNote[],
  onsetToleranceSec = 0.08,
): NoteScores {
  const used = new Set<number>();
  let matched = 0;
  for (const truthNote of truthNotes) {
    const matchIndex = estimatedNotes.findIndex(
      (note, index) =>
        !used.has(index) &&
        note.midi === truthNote.midi &&
        Math.abs(note.startSec - truthNote.startSec) <= onsetToleranceSec,
    );
    if (matchIndex >= 0) {
      used.add(matchIndex);
      matched++;
    }
  }
  return {
    recall: truthNotes.length > 0 ? matched / truthNotes.length : 0,
    precision: estimatedNotes.length > 0 ? matched / estimatedNotes.length : 0,
    matched,
  };
}
