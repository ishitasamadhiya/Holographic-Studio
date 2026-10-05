// Grades how far the extracted melody can be trusted as a pitch target.
import type { MelodyNote, MelodyQuality } from '@shared/music';

export interface MelodyEvidence {
  /**
   * Share of the tracked melody that turned out to be instruments and was removed (see
   * voiceLikeness.ts). When centred accompaniment competes this much with the lead, it also
   * takes over frames inside sung phrases, where it cannot be told apart.
   */
  instrumentShare: number;
  /** Fraction of frames in which a lead vocal was found. */
  voicedRatio: number;
  /** Mean per-frame confidence over the voiced frames, 0..1. */
  meanConfidence: number;
  /** Notes found per minute of audio. */
  notesPerMinute: number;
  /**
   * Fraction of voiced frames that sit within STABLE_DEVIATION_SEMITONES of the note they were
   * assigned to. Sung melodies dwell on notes; a track that hops between unrelated sounds or
   * slides around does not.
   */
  noteStability: number;
}

const STABLE_DEVIATION_SEMITONES = 0.6;

// Below any of the "poor" limits the melody is not used at all (the autotune falls back to
// the key). A song with a lead vocal is voiced for a third to two thirds of its length; the
// leftovers found in purely instrumental material stay far below 5 %.
const POOR_VOICED_RATIO = 0.05;
const POOR_NOTES_PER_MINUTE = 6;
/** Mean confidence of a lead that only just clears the voicing threshold. */
const POOR_MEAN_CONFIDENCE = 0.45;
const POOR_NOTE_STABILITY = 0.5;
/**
 * On the synthetic songs: 0-7 % with the accompaniment spread wide; 10-63 % with centred pads,
 * a centred synth lead, a narrowed or a mono mix. Above 25 % most songs had lost pitch accuracy
 * or note precision (down to 40 % and 15 %). Between 10 and 20 % most kept over 90 % accuracy,
 * but not all (70-83 % for some mono mixes), which is why such a melody is at best 'fair'.
 */
const POOR_INSTRUMENT_SHARE = 0.25;

// All "good" limits must be met for the best grade: a clearly dominant, steady lead.
const GOOD_VOICED_RATIO = 0.12;
const GOOD_NOTES_PER_MINUTE = 15;
const GOOD_MEAN_CONFIDENCE = 0.6;
const GOOD_NOTE_STABILITY = 0.75;
const GOOD_MAX_INSTRUMENT_SHARE = 0.1;

export function gradeMelody(evidence: MelodyEvidence): MelodyQuality {
  const { instrumentShare, voicedRatio, meanConfidence, notesPerMinute, noteStability } = evidence;
  if (
    instrumentShare >= POOR_INSTRUMENT_SHARE ||
    voicedRatio < POOR_VOICED_RATIO ||
    notesPerMinute < POOR_NOTES_PER_MINUTE ||
    meanConfidence < POOR_MEAN_CONFIDENCE ||
    noteStability < POOR_NOTE_STABILITY
  ) {
    return 'poor';
  }
  if (
    instrumentShare <= GOOD_MAX_INSTRUMENT_SHARE &&
    voicedRatio >= GOOD_VOICED_RATIO &&
    notesPerMinute >= GOOD_NOTES_PER_MINUTE &&
    meanConfidence >= GOOD_MEAN_CONFIDENCE &&
    noteStability >= GOOD_NOTE_STABILITY
  ) {
    return 'good';
  }
  return 'fair';
}

/**
 * Fraction of voiced frames lying on a note (see MelodyEvidence.noteStability).
 * `pitchMidi` is the tuning-corrected contour the notes were segmented from.
 */
export function measureNoteStability(
  pitchMidi: Float32Array,
  notes: readonly MelodyNote[],
  hopSec: number,
): number {
  let voiced = 0;
  for (let frame = 0; frame < pitchMidi.length; frame++) {
    if (!Number.isNaN(pitchMidi[frame]!)) voiced++;
  }
  if (voiced === 0) return 0;
  let stable = 0;
  for (const note of notes) {
    const start = Math.round(note.startSec / hopSec);
    const end = Math.min(pitchMidi.length, Math.round(note.endSec / hopSec));
    for (let frame = start; frame < end; frame++) {
      if (Math.abs(pitchMidi[frame]! - note.midi) <= STABLE_DEVIATION_SEMITONES) stable++;
    }
  }
  return stable / voiced;
}
