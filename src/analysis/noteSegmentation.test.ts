import { describe, expect, it } from 'vitest';
import { segmentNotes } from './noteSegmentation';

const HOP_SEC = 0.01;

/** Builds a contour from [frameCount, pitch | null] segments; pitch may be a function of the frame. */
function contourOf(
  segments: readonly (readonly [number, number | null | ((frame: number) => number)])[],
): Float32Array {
  const pitch: number[] = [];
  for (const [count, value] of segments) {
    for (let index = 0; index < count; index++) {
      if (value === null) pitch.push(Number.NaN);
      else pitch.push(typeof value === 'function' ? value(index) : value);
    }
  }
  return Float32Array.from(pitch);
}

function segment(pitch: Float32Array) {
  return segmentNotes(pitch, new Float32Array(pitch.length).fill(0.8), HOP_SEC);
}

describe('segmentNotes', () => {
  it('splits at a pitch step, exactly where it happens', () => {
    const notes = segment(
      contourOf([
        [10, null],
        [40, 60],
        [30, 62],
        [10, null],
      ]),
    );
    expect(notes.map((note) => note.midi)).toEqual([60, 62]);
    expect(notes[0]!.startSec).toBeCloseTo(0.1, 9);
    expect(notes[0]!.endSec).toBeCloseTo(0.5, 9);
    expect(notes[1]!.startSec).toBeCloseTo(0.5, 9);
    expect(notes[1]!.endSec).toBeCloseTo(0.8, 9);
  });

  it('keeps a note with wide vibrato in one piece', () => {
    const vibrato = (frame: number) => 64.2 + 0.7 * Math.sin(2 * Math.PI * 6 * frame * HOP_SEC);
    const notes = segment(contourOf([[100, vibrato]]));
    expect(notes.map((note) => note.midi)).toEqual([64]);
    expect(notes[0]!.endSec - notes[0]!.startSec).toBeCloseTo(1, 9);
  });

  it('puts the boundary inside a glide and adds no passing notes', () => {
    const glide = (frame: number) => 60 + (4 * (frame + 1)) / 7;
    const notes = segment(
      contourOf([
        [40, 60],
        [6, glide],
        [40, 64],
      ]),
    );
    expect(notes.map((note) => note.midi)).toEqual([60, 64]);
    expect(notes[1]!.startSec).toBeGreaterThanOrEqual(0.4);
    expect(notes[1]!.startSec).toBeLessThanOrEqual(0.46);
  });

  it('ignores a brief semitone excursion but reports one that lasts', () => {
    const brief = segment(
      contourOf([
        [40, 60],
        [5, 61],
        [40, 60],
      ]),
    );
    expect(brief.map((note) => note.midi)).toEqual([60]);
    const lasting = segment(
      contourOf([
        [40, 60],
        [12, 61],
        [40, 60],
      ]),
    );
    expect(lasting.map((note) => note.midi)).toEqual([60, 61, 60]);
  });

  it('starts a new note after a silence even at the same pitch', () => {
    const notes = segment(
      contourOf([
        [30, 67],
        [6, null],
        [30, 67],
      ]),
    );
    expect(notes.map((note) => note.midi)).toEqual([67, 67]);
    expect(notes[1]!.startSec).toBeCloseTo(0.36, 9);
  });

  it('folds an onset glitch into the note that follows', () => {
    const notes = segment(
      contourOf([
        [5, null],
        [3, 67],
        [40, 60],
        [5, null],
      ]),
    );
    expect(notes.map((note) => note.midi)).toEqual([60]);
    expect(notes[0]!.startSec).toBeCloseTo(0.05, 9);
  });

  it('rounds sustained pitches to the nearest semitone', () => {
    const notes = segment(
      contourOf([
        [40, 59.7],
        [40, 62.4],
      ]),
    );
    expect(notes.map((note) => note.midi)).toEqual([60, 62]);
  });

  it('reports the mean confidence of each note', () => {
    const pitch = contourOf([
      [20, 60],
      [20, 64],
    ]);
    const confidence = Float32Array.from({ length: 40 }, (_, frame) => (frame < 20 ? 0.5 : 1));
    const notes = segmentNotes(pitch, confidence, HOP_SEC);
    expect(notes[0]!.confidence).toBeCloseTo(0.5, 6);
    expect(notes[1]!.confidence).toBeCloseTo(1, 6);
  });

  it('returns nothing for silence or for a blip shorter than a note', () => {
    expect(segment(contourOf([[50, null]]))).toEqual([]);
    expect(
      segment(
        contourOf([
          [20, null],
          [5, 60],
          [20, null],
        ]),
      ),
    ).toEqual([]);
    expect(segment(new Float32Array(0))).toEqual([]);
  });
});
