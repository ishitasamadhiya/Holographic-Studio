import { describe, expect, it } from 'vitest';
import {
  createPitchClassMask,
  fillPitchClassMask,
  foldToNearestOctave,
  nearestAllowedNote,
} from './scale';

function maskFor(key: Parameters<typeof fillPitchClassMask>[1]): Uint8Array {
  const mask = createPitchClassMask();
  fillPitchClassMask(mask, key);
  return mask;
}

describe('fillPitchClassMask', () => {
  it('allows every semitone when there is no key', () => {
    expect(Array.from(maskFor(null))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('marks the notes of a major key', () => {
    // C major: C D E F G A B
    expect(Array.from(maskFor({ tonic: 0, mode: 'major', confidence: 1 }))).toEqual([
      1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1,
    ]);
    // A major: A B C♯ D E F♯ G♯
    expect(Array.from(maskFor({ tonic: 9, mode: 'major', confidence: 1 }))).toEqual([
      0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1,
    ]);
  });

  it('marks the notes of a minor key', () => {
    // A minor shares its notes with C major.
    expect(Array.from(maskFor({ tonic: 9, mode: 'minor', confidence: 1 }))).toEqual(
      Array.from(maskFor({ tonic: 0, mode: 'major', confidence: 1 })),
    );
    // E minor: E F♯ G A B C D
    expect(Array.from(maskFor({ tonic: 4, mode: 'minor', confidence: 1 }))).toEqual([
      1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1,
    ]);
  });

  it('accepts tonics outside 0..11 and treats unusable keys as no key', () => {
    expect(Array.from(maskFor({ tonic: 12, mode: 'major', confidence: 1 }))).toEqual(
      Array.from(maskFor({ tonic: 0, mode: 'major', confidence: 1 })),
    );
    expect(Array.from(maskFor({ tonic: -3, mode: 'major', confidence: 1 }))).toEqual(
      Array.from(maskFor({ tonic: 9, mode: 'major', confidence: 1 })),
    );
    const broken = { tonic: Number.NaN, mode: 'major', confidence: 1 } as const;
    expect(Array.from(maskFor(broken))).toEqual(Array.from(maskFor(null)));
    const unknownMode = { tonic: 0, mode: 'dorian', confidence: 1 } as unknown as Parameters<
      typeof fillPitchClassMask
    >[1];
    expect(Array.from(maskFor(unknownMode))).toEqual(Array.from(maskFor(null)));
  });
});

describe('foldToNearestOctave', () => {
  it('moves a note into the octave around the reference pitch', () => {
    expect(foldToNearestOctave(72, 57.2)).toBe(60);
    expect(foldToNearestOctave(45, 70)).toBe(69);
    expect(foldToNearestOctave(60, 60.4)).toBe(60);
    expect(foldToNearestOctave(60, 96.1)).toBe(96);
    expect(foldToNearestOctave(67, 50)).toBe(55);
  });

  it('never ends up more than six semitones from the reference', () => {
    for (let note = 36; note <= 96; note++) {
      for (let reference = 40; reference <= 90; reference += 0.7) {
        const folded = foldToNearestOctave(note, reference);
        expect(Math.abs(folded - reference)).toBeLessThanOrEqual(6);
        expect((((folded - note) % 12) + 12) % 12).toBe(0);
      }
    }
  });
});

describe('nearestAllowedNote', () => {
  const chromatic = maskFor(null);
  const cMajor = maskFor({ tonic: 0, mode: 'major', confidence: 1 });
  const none = Number.NaN;

  it('rounds to the nearest semitone when every note is allowed', () => {
    expect(nearestAllowedNote(60.2, chromatic, none, 0)).toBe(60);
    expect(nearestAllowedNote(60.7, chromatic, none, 0)).toBe(61);
    expect(nearestAllowedNote(59.51, chromatic, none, 0)).toBe(60);
    expect(nearestAllowedNote(33.4, chromatic, none, 0)).toBe(33);
    expect(nearestAllowedNote(101.6, chromatic, none, 0)).toBe(102);
  });

  it('snaps to the nearest note of the scale', () => {
    expect(nearestAllowedNote(61.4, cMajor, none, 0)).toBe(62);
    expect(nearestAllowedNote(60.9, cMajor, none, 0)).toBe(60);
    expect(nearestAllowedNote(63.2, cMajor, none, 0)).toBe(64);
    expect(nearestAllowedNote(65.6, cMajor, none, 0)).toBe(65);
    expect(nearestAllowedNote(70.4, cMajor, none, 0)).toBe(71);
    // Same pitch classes in every octave.
    expect(nearestAllowedNote(49.4, cMajor, none, 0)).toBe(50);
    expect(nearestAllowedNote(85.4, cMajor, none, 0)).toBe(86);
  });

  it('breaks an exact tie toward the lower note', () => {
    expect(nearestAllowedNote(61, cMajor, none, 0)).toBe(60);
    expect(nearestAllowedNote(60.5, chromatic, none, 0)).toBe(60);
  });

  it('keeps the held note until the pitch is clearly closer to another one', () => {
    // Between C (60) and D (62) the plain boundary is 61; holding C moves it to 61.15.
    expect(nearestAllowedNote(61.1, cMajor, 60, 0.3)).toBe(60);
    expect(nearestAllowedNote(61.2, cMajor, 60, 0.3)).toBe(62);
    // Holding D moves it the other way.
    expect(nearestAllowedNote(60.9, cMajor, 62, 0.3)).toBe(62);
    expect(nearestAllowedNote(60.8, cMajor, 62, 0.3)).toBe(60);
  });

  it('gives no advantage to a held note that is not allowed', () => {
    expect(nearestAllowedNote(61.1, cMajor, 61, 0.3)).toBe(62);
  });

  it('returns NaN for a pitch that is not a finite number, without looping', () => {
    for (const midi of [Infinity, -Infinity, Number.NaN]) {
      expect(nearestAllowedNote(midi, cMajor, none, 0.2)).toBeNaN();
      expect(nearestAllowedNote(midi, chromatic, 60, 0.2)).toBeNaN();
    }
  });

  it('falls back to the nearest semitone when the mask allows nothing', () => {
    expect(nearestAllowedNote(61.3, new Uint8Array(12), none, 0)).toBe(61);
  });
});
