// Turns the pitch contour into discrete notes.
import type { MelodyNote } from '@shared/music';
import { forEachVoicedRun } from './contourCleanup';

/**
 * Price of starting a new note, in the same unit as the fit error (semitones of deviation
 * summed over frames). A singer's vibrato swings up to a semitone around the note and would
 * otherwise be chopped into alternating notes; a real step of a semitone pays for itself once
 * it lasts longer than this many frames (twice that when the melody returns to the old note).
 */
const NOTE_CHANGE_COST = 3.5;
/** Deviations larger than this all count the same: glides should not dominate the fit. */
const MAX_FRAME_ERROR = 2;
/** Notes shorter than this are merged into a neighbour (they are onsets, glides or glitches). */
const MIN_NOTE_SEC = 0.08;

interface NoteSpan {
  /** First frame of the note. */
  start: number;
  /** One past the last frame. */
  end: number;
  midi: number;
}

/**
 * Best piecewise-constant fit of integer notes to one voiced stretch: minimises the summed
 * |pitch - note| plus NOTE_CHANGE_COST per note change (dynamic programming over note states).
 */
function fitNotes(pitch: Float32Array, start: number, end: number): NoteSpan[] {
  let lowest = Infinity;
  let highest = -Infinity;
  for (let frame = start; frame < end; frame++) {
    lowest = Math.min(lowest, pitch[frame]!);
    highest = Math.max(highest, pitch[frame]!);
  }
  const firstNote = Math.round(lowest);
  const stateCount = Math.round(highest) - firstNote + 1;
  const frameCount = end - start;

  const backPointer = new Int16Array(frameCount * stateCount);
  let previous = new Float64Array(stateCount);
  let current = new Float64Array(stateCount);
  for (let index = 0; index < frameCount; index++) {
    let bestPrevious = 0;
    for (let state = 1; state < stateCount; state++) {
      if (previous[state]! < previous[bestPrevious]!) bestPrevious = state;
    }
    const switchBase = previous[bestPrevious]! + NOTE_CHANGE_COST;
    const value = pitch[start + index]!;
    for (let state = 0; state < stateCount; state++) {
      const error = Math.min(MAX_FRAME_ERROR, Math.abs(value - (firstNote + state)));
      const stay = previous[state]!;
      if (index > 0 && switchBase < stay) {
        current[state] = switchBase + error;
        backPointer[index * stateCount + state] = bestPrevious;
      } else {
        current[state] = stay + error;
        backPointer[index * stateCount + state] = state;
      }
    }
    [previous, current] = [current, previous];
  }

  let state = 0;
  for (let candidate = 1; candidate < stateCount; candidate++) {
    if (previous[candidate]! < previous[state]!) state = candidate;
  }
  const spans: NoteSpan[] = [];
  let spanEnd = end;
  for (let index = frameCount - 1; index >= 0; index--) {
    const from = backPointer[index * stateCount + state]!;
    if (index === 0 || from !== state) {
      spans.push({ start: start + index, end: spanEnd, midi: firstNote + state });
      spanEnd = start + index;
      state = from;
    }
  }
  return spans.reverse();
}

/** Merges too-short notes into an adjacent note of the same stretch (the later one if any). */
function absorbShortNotes(spans: NoteSpan[], minFrames: number): NoteSpan[] {
  const result = spans.slice();
  let index = 0;
  while (index < result.length && result.length > 1) {
    const span = result[index]!;
    if (span.end - span.start >= minFrames) {
      index++;
      continue;
    }
    const next = result[index + 1];
    const previous = result[index - 1];
    if (next) next.start = span.start;
    else if (previous) previous.end = span.end;
    result.splice(index, 1);
  }
  // Neighbours that ended up with the same pitch are one note.
  const merged: NoteSpan[] = [];
  for (const span of result) {
    const last = merged[merged.length - 1];
    if (last && last.midi === span.midi && last.end === span.start) last.end = span.end;
    else merged.push({ ...span });
  }
  return merged;
}

/**
 * Segments a contour into notes.
 *
 * @param pitchMidi Fractional MIDI pitch per frame (NaN = unvoiced), with the song's tuning
 *   offset already removed so that notes sit on integers.
 * @param confidence 0..1 per frame.
 */
export function segmentNotes(
  pitchMidi: Float32Array,
  confidence: ArrayLike<number>,
  hopSec: number,
): MelodyNote[] {
  const minFrames = Math.round(MIN_NOTE_SEC / hopSec);
  const notes: MelodyNote[] = [];
  forEachVoicedRun(pitchMidi, (start, end) => {
    if (end - start < minFrames) return;
    for (const span of absorbShortNotes(fitNotes(pitchMidi, start, end), minFrames)) {
      let confidenceSum = 0;
      for (let frame = span.start; frame < span.end; frame++) confidenceSum += confidence[frame]!;
      notes.push({
        startSec: span.start * hopSec,
        endSec: span.end * hopSec,
        midi: span.midi,
        confidence: confidenceSum / (span.end - span.start),
      });
    }
  });
  return notes;
}
