import { describe, expect, it } from 'vitest';
import type { TrackedMelody } from './melodyTracker';
import { keepVoiceLikePhrases, movingShare } from './voiceLikeness';

const HOP_SEC = 0.01;

/** A melody from per-frame pitches (NaN = unvoiced), every voiced frame with dominance 0.5. */
function melodyOf(pitches: number[]): TrackedMelody {
  const pitchMidi = Float32Array.from(pitches);
  const dominance = Float32Array.from(pitches, (pitch) => (Number.isNaN(pitch) ? 0 : 0.5));
  return { pitchMidi, dominance };
}

/** Notes held perfectly steady, changing in one step: a keyboard or synth line. */
function steadyNotes(notes: readonly number[], framesPerNote: number): number[] {
  return notes.flatMap((midi) => new Array<number>(framesPerNote).fill(midi));
}

/** Sung notes: +/-`vibratoCents` at 5.5 Hz and a 60 ms glide into each new note. */
function sungNotes(notes: readonly number[], framesPerNote: number, vibratoCents = 30): number[] {
  const pitches: number[] = [];
  notes.forEach((midi, index) => {
    const previous = notes[index - 1] ?? midi;
    for (let frame = 0; frame < framesPerNote; frame++) {
      const glide = Math.min(1, frame / 6);
      const vibrato =
        (vibratoCents / 100) * Math.sin(2 * Math.PI * 5.5 * (pitches.length * HOP_SEC));
      pitches.push(previous + (midi - previous) * glide + vibrato);
    }
  });
  return pitches;
}

function rest(frames: number): number[] {
  return new Array<number>(frames).fill(Number.NaN);
}

function voicedCount(pitchMidi: Float32Array): number {
  return pitchMidi.filter((pitch) => !Number.isNaN(pitch)).length;
}

describe('movingShare', () => {
  it('is zero for steady notes, even across steps between them', () => {
    const pitch = Float32Array.from(steadyNotes([60, 62, 64, 65], 40));
    expect(movingShare(pitch, 0, pitch.length)).toBe(0);
  });

  it('is high for a voice with vibrato and glides', () => {
    const pitch = Float32Array.from(sungNotes([60, 62, 64, 65], 40));
    expect(movingShare(pitch, 0, pitch.length)).toBeGreaterThan(0.6);
  });

  it('ignores frames next to gaps', () => {
    const pitch = Float32Array.from([60, Number.NaN, 61, 62, Number.NaN]);
    expect(movingShare(pitch, 0, pitch.length)).toBe(0);
  });
});

describe('keepVoiceLikePhrases', () => {
  it('keeps a sung phrase untouched', () => {
    const pitches = [...rest(20), ...sungNotes([64, 66, 67, 69, 67], 30), ...rest(20)];
    const melody = melodyOf(pitches);
    const result = keepVoiceLikePhrases(melody);
    expect(result).toEqual({ rejectedFrames: 0, keptFrames: 150 });
    expect(Array.from(melody.pitchMidi)).toEqual(Array.from(Float32Array.from(pitches)));
  });

  it('removes an instrument line that holds every note perfectly steady', () => {
    const melody = melodyOf([
      ...steadyNotes([64, 66, 67, 69], 30),
      ...rest(10),
      ...steadyNotes([67, 64], 40),
    ]);
    expect(keepVoiceLikePhrases(melody)).toEqual({ rejectedFrames: 200, keptFrames: 0 });
    expect(voicedCount(melody.pitchMidi)).toBe(0);
    expect(Array.from(melody.dominance).every((value) => value === 0)).toBe(true);
  });

  it('judges each phrase on its own', () => {
    const melody = melodyOf([
      ...sungNotes([64, 66, 67], 40),
      ...rest(60),
      ...steadyNotes([60, 62], 60),
      ...rest(60),
      ...sungNotes([69, 67], 40),
    ]);
    expect(keepVoiceLikePhrases(melody)).toEqual({ rejectedFrames: 120, keptFrames: 200 });
    expect(voicedCount(melody.pitchMidi.subarray(0, 120))).toBe(120);
    expect(voicedCount(melody.pitchMidi.subarray(180, 300))).toBe(0);
  });

  it('removes a long steady note the tracker slid onto at the end of a sung phrase', () => {
    // A held chord note right after the singing stops, as happens in mono mixes.
    const melody = melodyOf([...sungNotes([64, 66, 67, 69], 40), ...steadyNotes([55], 80)]);
    keepVoiceLikePhrases(melody);
    expect(voicedCount(melody.pitchMidi.subarray(0, 160))).toBe(160);
    expect(voicedCount(melody.pitchMidi.subarray(160))).toBe(0);
  });

  it('keeps a short straight sung note inside a phrase', () => {
    const pitches = [...sungNotes([64, 66], 50), ...steadyNotes([67], 25), ...sungNotes([69], 60)];
    const melody = melodyOf(pitches);
    keepVoiceLikePhrases(melody);
    expect(voicedCount(melody.pitchMidi)).toBe(pitches.length);
  });

  it('removes a phrase in the bass register however much its pitch moves', () => {
    const melody = melodyOf(sungNotes([40, 42, 43, 40], 40));
    expect(keepVoiceLikePhrases(melody).keptFrames).toBe(0);
    const lowMaleVoice = melodyOf(sungNotes([45, 47, 48, 50], 40));
    expect(keepVoiceLikePhrases(lowMaleVoice).rejectedFrames).toBe(0);
  });

  it('accepts a melody with nothing voiced', () => {
    const melody = melodyOf(rest(50));
    expect(keepVoiceLikePhrases(melody)).toEqual({ rejectedFrames: 0, keptFrames: 0 });
  });
});
