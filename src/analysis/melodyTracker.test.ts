import { describe, expect, it } from 'vitest';
import { createMelodyCandidates, trackMelody, type MelodyCandidates } from './melodyTracker';
import { CANDIDATES_PER_FRAME } from './salience';

const HOP_SEC = 0.01;
const THRESHOLD = 0.15;

interface Candidate {
  pitch: number;
  salience: number;
  dominance: number;
}

/** Builds candidates from a per-frame list (strongest first, as the extractor delivers them). */
function candidatesFrom(frames: Candidate[][]): MelodyCandidates {
  const candidates = createMelodyCandidates(frames.length);
  frames.forEach((frame, frameIndex) => {
    [...frame]
      .sort((a, b) => b.salience - a.salience)
      .slice(0, CANDIDATES_PER_FRAME)
      .forEach((candidate, slot) => {
        const index = frameIndex * CANDIDATES_PER_FRAME + slot;
        candidates.pitchMidi[index] = candidate.pitch;
        candidates.salience[index] = candidate.salience;
        candidates.dominance[index] = candidate.dominance;
      });
  });
  return candidates;
}

function voicedFrames(pitch: Float32Array): number[] {
  return Array.from(pitch.keys()).filter((frame) => !Number.isNaN(pitch[frame]!));
}

const background: Candidate = { pitch: 48, salience: 0.3, dominance: 0.03 };

describe('trackMelody', () => {
  it('marks exactly the frames with a dominant candidate as voiced', () => {
    const frames = Array.from({ length: 120 }, (_, frame) =>
      frame >= 30 && frame < 90
        ? [{ pitch: 64, salience: 1, dominance: 0.6 }, background]
        : [background],
    );
    const melody = trackMelody(candidatesFrom(frames), HOP_SEC, THRESHOLD);
    expect(voicedFrames(melody.pitchMidi)).toEqual(
      Array.from({ length: 60 }, (_, index) => 30 + index),
    );
    expect(melody.pitchMidi[50]).toBe(64);
    expect(melody.dominance[50]).toBeCloseTo(0.6, 6);
    expect(melody.dominance[10]).toBe(0);
  });

  it('stays silent when nothing is dominant, and for empty input', () => {
    const frames = Array.from({ length: 80 }, () => [{ pitch: 60, salience: 1, dominance: 0.1 }]);
    expect(voicedFrames(trackMelody(candidatesFrom(frames), HOP_SEC, THRESHOLD).pitchMidi)).toEqual(
      [],
    );
    expect(trackMelody(createMelodyCandidates(0), HOP_SEC, THRESHOLD).pitchMidi.length).toBe(0);
    const empty = trackMelody(createMelodyCandidates(25), HOP_SEC, THRESHOLD);
    expect(voicedFrames(empty.pitchMidi)).toEqual([]);
  });

  it('does not start a note for one stray frame', () => {
    const frames = Array.from({ length: 60 }, (_, frame) =>
      frame === 30 ? [{ pitch: 70, salience: 1, dominance: 0.9 }] : [background],
    );
    expect(voicedFrames(trackMelody(candidatesFrom(frames), HOP_SEC, THRESHOLD).pitchMidi)).toEqual(
      [],
    );
  });

  it('carries a note across a short drop-out', () => {
    const frames = Array.from({ length: 100 }, (_, frame) => {
      const masked = frame >= 48 && frame < 51;
      return frame >= 20 && frame < 80
        ? [{ pitch: 62, salience: 1, dominance: masked ? 0.02 : 0.6 }]
        : [background];
    });
    const melody = trackMelody(candidatesFrom(frames), HOP_SEC, THRESHOLD);
    expect(voicedFrames(melody.pitchMidi).length).toBe(60);
  });

  it('requires more dominance when the threshold is raised', () => {
    const frames = Array.from({ length: 100 }, (_, frame) =>
      frame >= 20 && frame < 80 ? [{ pitch: 62, salience: 1, dominance: 0.4 }] : [background],
    );
    const candidates = candidatesFrom(frames);
    expect(voicedFrames(trackMelody(candidates, HOP_SEC, 0.15).pitchMidi).length).toBe(60);
    expect(voicedFrames(trackMelody(candidates, HOP_SEC, 0.45).pitchMidi).length).toBe(0);
  });

  it('follows the dominant candidate rather than a more salient accompaniment note', () => {
    const frames = Array.from({ length: 100 }, () => [
      { pitch: 55, salience: 1, dominance: 0.1 },
      { pitch: 66, salience: 0.8, dominance: 0.55 },
    ]);
    const melody = trackMelody(candidatesFrom(frames), HOP_SEC, THRESHOLD);
    expect(new Set(melody.pitchMidi)).toEqual(new Set([66]));
  });

  it('does not hop to a rival for a few frames', () => {
    const frames = Array.from({ length: 100 }, (_, frame) => {
      const rivalWins = frame >= 50 && frame < 53;
      return [
        { pitch: 60, salience: rivalWins ? 0.7 : 1, dominance: 0.5 },
        { pitch: 67, salience: rivalWins ? 1 : 0.6, dominance: 0.5 },
      ];
    });
    const melody = trackMelody(candidatesFrom(frames), HOP_SEC, THRESHOLD);
    expect(new Set(melody.pitchMidi)).toEqual(new Set([60]));
  });

  it('follows a real change of note', () => {
    const frames = Array.from({ length: 100 }, (_, frame) => [
      { pitch: frame < 50 ? 60 : 67, salience: 1, dominance: 0.5 },
    ]);
    const melody = trackMelody(candidatesFrom(frames), HOP_SEC, THRESHOLD);
    expect(melody.pitchMidi[49]).toBe(60);
    expect(melody.pitchMidi[50]).toBe(67);
  });

  it('resolves an octave ambiguity from the register of the surrounding melody', () => {
    // Four seconds clearly around MIDI 60, then a note where the octave above is the more
    // salient candidate with the same dominance: on its own evidence that note would be
    // tracked at 72.
    const frames = Array.from({ length: 460 }, (_, frame) => {
      const ambiguous = frame >= 400;
      return [
        { pitch: 60, salience: ambiguous ? 0.85 : 1, dominance: 0.5 },
        { pitch: 72, salience: ambiguous ? 1 : 0.5, dominance: 0.5 },
      ];
    });
    const ambiguousOnly = trackMelody(candidatesFrom(frames.slice(400)), HOP_SEC, THRESHOLD);
    expect(new Set(ambiguousOnly.pitchMidi)).toEqual(new Set([72]));
    const inContext = trackMelody(candidatesFrom(frames), HOP_SEC, THRESHOLD);
    expect(new Set(inContext.pitchMidi)).toEqual(new Set([60]));
  });

  it('keeps a phrase sung an octave higher in its own register', () => {
    // Four seconds around MIDI 60, a one-second rest, then a phrase an octave up (call and
    // response). The octave below is a strong rival in both phrases; the later phrase must not
    // be pulled down to the register of the earlier one.
    const frames = Array.from({ length: 650 }, (_, frame) => {
      if (frame < 400) {
        return [
          { pitch: 60, salience: 1, dominance: 0.5 },
          { pitch: 48, salience: 0.7, dominance: 0.5 },
        ];
      }
      if (frame < 500) return [background];
      return [
        { pitch: 72, salience: 1, dominance: 0.5 },
        { pitch: 60, salience: 0.7, dominance: 0.5 },
      ];
    });
    const melody = trackMelody(candidatesFrom(frames), HOP_SEC, THRESHOLD);
    expect(new Set(melody.pitchMidi.subarray(0, 400))).toEqual(new Set([60]));
    expect(new Set(melody.pitchMidi.subarray(500))).toEqual(new Set([72]));
  });
});
