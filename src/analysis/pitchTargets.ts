// Reduces a ReferenceAnalysis to the compact pitch-target data the realtime autotune reads.
import type { KeyEstimate, PitchTargetData, ReferenceAnalysis } from '@shared/music';
import type { AlignmentEstimate } from './types';

/**
 * Minimum alignment confidence for placing melody notes on the backing track's clock. Below
 * it the offset may be off by a beat or a bar, and a melody that is in the wrong place is
 * worse than no melody: the autotune would pull toward the wrong notes.
 */
export const MIN_ALIGNMENT_CONFIDENCE = 0.5;

/**
 * Minimum key confidence for snapping to the detected scale. Below it the autotune snaps to
 * the nearest semitone instead, which can never pull a correct note out of the song's key.
 */
export const MIN_KEY_CONFIDENCE = 0.3;

export interface PitchTargetOptions {
  /**
   * True when a backing track is loaded, i.e. there is a song clock to look notes up on.
   * Without one the melody cannot be followed and only key and tuning are used.
   */
  hasSongClock: boolean;
  /**
   * Offset between backing track and reference song (referenceTime = backingTime + offsetSec).
   * null means the caller asserts that the two are already aligned (offset 0).
   */
  alignment: AlignmentEstimate | null;
}

function melodyIsUsable(analysis: ReferenceAnalysis, options: PitchTargetOptions): boolean {
  if (analysis.quality === 'poor' || !options.hasSongClock) return false;
  return options.alignment === null || options.alignment.confidence >= MIN_ALIGNMENT_CONFIDENCE;
}

/** Melody notes as [startSec, endSec, midi] triples in song time, sorted by start. */
function notesInSongTime(analysis: ReferenceAnalysis, offsetSec: number): Float32Array {
  const shifted = analysis.notes
    .map((note) => ({
      // Song time = reference time - offset. Notes before the backing track starts are
      // dropped; one that straddles the start is cut there.
      startSec: Math.max(0, note.startSec - offsetSec),
      endSec: note.endSec - offsetSec,
      midi: note.midi,
    }))
    .filter((note) => note.endSec > note.startSec)
    .sort((a, b) => a.startSec - b.startSec);

  const triples = new Float32Array(shifted.length * 3);
  shifted.forEach((note, index) => {
    triples[index * 3] = note.startSec;
    triples[index * 3 + 1] = note.endSec;
    triples[index * 3 + 2] = note.midi;
  });
  return triples;
}

/**
 * Decides what the autotune may use from the analysis:
 *  - melody notes (shifted onto the backing track's clock) only when the melody is not graded
 *    'poor', a song clock exists, and the alignment is either asserted (null) or confident;
 *  - the key only when its confidence is adequate (otherwise null = chromatic);
 *  - the tuning offset always.
 */
export function buildPitchTargets(
  analysis: ReferenceAnalysis,
  options: PitchTargetOptions,
): PitchTargetData {
  const key: KeyEstimate | null =
    analysis.key.confidence >= MIN_KEY_CONFIDENCE ? { ...analysis.key } : null;
  const notes = melodyIsUsable(analysis, options)
    ? notesInSongTime(analysis, options.alignment?.offsetSec ?? 0)
    : new Float32Array(0);
  return { notes, key, tuningCents: analysis.tuningCents };
}
