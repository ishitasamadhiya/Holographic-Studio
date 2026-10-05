import { describe, expect, it } from 'vitest';
import { cleanContour, forEachVoicedRun } from './contourCleanup';
import type { TrackedMelody } from './melodyTracker';

const THRESHOLD = 0.15;

/** Builds a melody from [frameCount, pitch | null, dominance] segments. */
function melodyOf(segments: readonly (readonly [number, number | null, number?])[]): TrackedMelody {
  const pitch: number[] = [];
  const dominance: number[] = [];
  for (const [count, value, strength] of segments) {
    for (let index = 0; index < count; index++) {
      pitch.push(value ?? Number.NaN);
      dominance.push(value === null ? 0 : (strength ?? 0.6));
    }
  }
  return { pitchMidi: Float32Array.from(pitch), dominance: Float32Array.from(dominance) };
}

function runsOf(melody: TrackedMelody): [number, number][] {
  const runs: [number, number][] = [];
  forEachVoicedRun(melody.pitchMidi, (start, end) => runs.push([start, end]));
  return runs;
}

describe('forEachVoicedRun', () => {
  it('reports every maximal voiced stretch, including ones touching the ends', () => {
    const melody = melodyOf([
      [3, 60],
      [2, null],
      [4, 62],
      [1, null],
      [2, 64],
    ]);
    expect(runsOf(melody)).toEqual([
      [0, 3],
      [5, 9],
      [10, 12],
    ]);
    expect(runsOf(melodyOf([[5, null]]))).toEqual([]);
  });
});

describe('cleanContour', () => {
  it('bridges a short drop-out inside a note and interpolates the pitch', () => {
    const melody = melodyOf([
      [5, null],
      [20, 60],
      [4, null],
      [20, 60.8],
      [5, null],
    ]);
    cleanContour(melody, THRESHOLD);
    expect(runsOf(melody)).toEqual([[5, 49]]);
    expect(melody.pitchMidi[26]).toBeGreaterThan(60);
    expect(melody.pitchMidi[26]).toBeLessThan(60.8);
    expect(melody.dominance[26]).toBeCloseTo(0.6, 6);
  });

  it('does not bridge a longer gap or a gap between different notes', () => {
    const longGap = melodyOf([
      [20, 60],
      [5, null],
      [20, 60],
    ]);
    cleanContour(longGap, THRESHOLD);
    expect(runsOf(longGap).length).toBe(2);

    const differentNotes = melodyOf([
      [20, 60],
      [3, null],
      [20, 63],
    ]);
    cleanContour(differentNotes, THRESHOLD);
    expect(runsOf(differentNotes).length).toBe(2);
  });

  it('turns frames without any energy at the pitch into silence, splitting the note', () => {
    const melody = melodyOf([
      [20, 60],
      [6, 60, 0.01],
      [20, 60],
    ]);
    cleanContour(melody, THRESHOLD);
    expect(runsOf(melody)).toEqual([
      [0, 20],
      [26, 46],
    ]);
  });

  it('removes single-frame pitch glitches but keeps real steps sharp', () => {
    const melody = melodyOf([
      [15, 60],
      [1, 72],
      [15, 60],
      [15, 64],
    ]);
    cleanContour(melody, THRESHOLD);
    expect(melody.pitchMidi[15]).toBe(60);
    expect(melody.pitchMidi[30]).toBe(60);
    expect(melody.pitchMidi[31]).toBe(64);
  });

  it('drops stretches that are too short to be a note', () => {
    const melody = melodyOf([
      [10, null],
      [7, 60, 0.9],
      [10, null],
      [8, 62, 0.9],
      [10, null],
    ]);
    cleanContour(melody, THRESHOLD);
    expect(runsOf(melody)).toEqual([[27, 35]]);
    expect(melody.dominance[12]).toBe(0);
  });

  it('drops stretches that are both short and weak, keeps strong or long ones', () => {
    // Evidence = frames x (dominance - threshold); 3 is required.
    const weakShort = melodyOf([
      [5, null],
      [20, 60, 0.25],
      [5, null],
    ]);
    cleanContour(weakShort, THRESHOLD);
    expect(runsOf(weakShort)).toEqual([]);

    const strongShort = melodyOf([
      [5, null],
      [10, 60, 0.5],
      [5, null],
    ]);
    cleanContour(strongShort, THRESHOLD);
    expect(runsOf(strongShort)).toEqual([[5, 15]]);

    const weakLong = melodyOf([
      [5, null],
      [40, 60, 0.25],
      [5, null],
    ]);
    cleanContour(weakLong, THRESHOLD);
    expect(runsOf(weakLong)).toEqual([[5, 45]]);
  });

  it('judges the evidence against the threshold the melody was tracked with', () => {
    const melody = melodyOf([
      [5, null],
      [20, 60, 0.5],
      [5, null],
    ]);
    cleanContour(melody, 0.45);
    expect(runsOf(melody)).toEqual([]);
  });
});
