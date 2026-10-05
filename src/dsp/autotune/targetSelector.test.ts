import type { KeyEstimate, PitchTargetData } from '@shared/music';
import { describe, expect, it } from 'vitest';
import {
  MELODY_PULL_RANGE_SEMITONES,
  MELODY_WINDOW_SEC,
  PitchTargetSelector,
  TARGET_HYSTERESIS_SEMITONES,
} from './targetSelector';

const C_MAJOR: KeyEstimate = { tonic: 0, mode: 'major', confidence: 0.9 };
const NO_CLOCK = Number.NaN;

function targets(
  melody: [startSec: number, endSec: number, midi: number][],
  key: KeyEstimate | null = C_MAJOR,
  tuningCents = 0,
): PitchTargetData {
  return { notes: Float32Array.from(melody.flat()), key, tuningCents };
}

function selectorFor(data: PitchTargetData | null): PitchTargetSelector {
  const selector = new PitchTargetSelector();
  selector.setTargets(data);
  return selector;
}

/** A fresh selector for every query, so hysteresis never carries over between assertions. */
function selectOnce(data: PitchTargetData | null, sungMidi: number, positionSec: number) {
  const selector = selectorFor(data);
  const target = selector.select(sungMidi, positionSec);
  return { target, source: selector.source };
}

// C♯4 (61) is not in C major, so a C♯ target can only have come from the melody.
const SONG = targets([
  [1.0, 1.5, 61],
  [1.5, 2.0, 62],
  [2.5, 3.0, 67],
]);

describe('PitchTargetSelector: melody', () => {
  it('uses the constants the brief asks for', () => {
    expect(MELODY_WINDOW_SEC).toBeCloseTo(0.15, 6);
    expect(MELODY_PULL_RANGE_SEMITONES).toBeCloseTo(2.5, 6);
    expect(TARGET_HYSTERESIS_SEMITONES).toBeGreaterThan(0);
    expect(TARGET_HYSTERESIS_SEMITONES).toBeLessThan(0.5);
  });

  it('targets the melody note sounding at the song position', () => {
    expect(selectOnce(SONG, 61.3, 1.2)).toEqual({ target: 61, source: 'melody' });
    expect(selectOnce(SONG, 60.6, 1.2)).toEqual({ target: 61, source: 'melody' });
    expect(selectOnce(SONG, 66.4, 2.7)).toEqual({ target: 67, source: 'melody' });
  });

  it('falls back to the scale in a gap between notes', () => {
    // 2.25 s: the previous note ended 0.25 s ago, the next starts in 0.25 s.
    expect(selectOnce(SONG, 61.3, 2.25)).toEqual({ target: 62, source: 'scale' });
    expect(selectOnce(SONG, 63.6, 2.25)).toEqual({ target: 64, source: 'scale' });
  });

  it('falls back to the scale before the first and after the last note', () => {
    expect(selectOnce(SONG, 61.3, 0.2)).toEqual({ target: 62, source: 'scale' });
    expect(selectOnce(SONG, 61.3, -5)).toEqual({ target: 62, source: 'scale' });
    expect(selectOnce(SONG, 66.6, 30)).toEqual({ target: 67, source: 'scale' });
  });

  it('considers notes within 150 ms of the song position, early or late', () => {
    // The singer anticipates the note that starts at 2.5 s…
    expect(selectOnce(SONG, 66.8, 2.4).source).toBe('melody');
    expect(selectOnce(SONG, 66.8, 2.36).source).toBe('melody');
    expect(selectOnce(SONG, 66.8, 2.34).source).toBe('scale');
    // …or hangs on to the one that ended at 2.0 s.
    expect(selectOnce(SONG, 62.2, 2.1).source).toBe('melody');
    expect(selectOnce(SONG, 62.2, 2.14).source).toBe('melody');
    expect(selectOnce(SONG, 62.2, 2.16).source).toBe('scale');
    // Before the first note starts at 1.0 s.
    expect(selectOnce(SONG, 61.2, 0.9)).toEqual({ target: 61, source: 'melody' });
    expect(selectOnce(SONG, 61.2, 0.8)).toEqual({ target: 62, source: 'scale' });
  });

  it('picks the nearest of several notes inside the window', () => {
    // Around 1.5 s both C♯ (61) and D (62) are within reach.
    expect(selectOnce(SONG, 61.2, 1.5).target).toBe(61);
    expect(selectOnce(SONG, 61.8, 1.5).target).toBe(62);
  });

  it('folds melody notes into the octave the singer is in', () => {
    expect(selectOnce(SONG, 49.3, 1.2)).toEqual({ target: 49, source: 'melody' });
    expect(selectOnce(SONG, 72.8, 1.2)).toEqual({ target: 73, source: 'melody' });
    expect(selectOnce(SONG, 85.1, 1.2)).toEqual({ target: 85, source: 'melody' });
    expect(selectOnce(SONG, 54.6, 2.7)).toEqual({ target: 55, source: 'melody' });
  });

  it('only pulls toward the melody when the singer is within the pull range', () => {
    // 2.4 semitones above C♯: still pulled to it.
    expect(selectOnce(SONG, 63.4, 1.2)).toEqual({ target: 61, source: 'melody' });
    expect(selectOnce(SONG, 58.6, 1.2)).toEqual({ target: 61, source: 'melody' });
    // 2.6 semitones away: a different line; snap to the scale instead.
    expect(selectOnce(SONG, 63.6, 1.2)).toEqual({ target: 64, source: 'scale' });
    expect(selectOnce(SONG, 58.4, 1.2)).toEqual({ target: 59, source: 'scale' });
    // A tritone away from every octave of the melody note.
    expect(selectOnce(SONG, 67.2, 1.2)).toEqual({ target: 67, source: 'scale' });
  });

  it('ignores the melody when no song clock is running', () => {
    expect(selectOnce(SONG, 61.3, NO_CLOCK)).toEqual({ target: 62, source: 'scale' });
    expect(selectOnce(SONG, 60.6, NO_CLOCK)).toEqual({ target: 60, source: 'scale' });
  });

  it('copes with the song position jumping backwards and forwards', () => {
    const selector = selectorFor(SONG);
    expect(selector.select(66.7, 2.7)).toBe(67);
    expect(selector.source).toBe('melody');
    // Restart from the top.
    expect(selector.select(61.2, 1.2)).toBe(61);
    expect(selector.source).toBe('melody');
    expect(selector.select(62.1, 1.8)).toBe(62);
    expect(selector.source).toBe('melody');
    expect(selector.select(61.2, 0.1)).toBe(62);
    expect(selector.source).toBe('scale');
    expect(selector.select(66.7, 2.9)).toBe(67);
    expect(selector.source).toBe('melody');
  });

  it('follows a long melody in order', () => {
    const melody: [number, number, number][] = [];
    for (let i = 0; i < 400; i++) melody.push([i * 0.5, i * 0.5 + 0.45, 48 + ((i * 7) % 24)]);
    const selector = selectorFor(targets(melody, null));
    for (let i = 0; i < 400; i++) {
      const expected = 48 + ((i * 7) % 24);
      expect(selector.select(expected + 0.3, i * 0.5 + 0.2)).toBe(expected);
      expect(selector.source).toBe('melody');
    }
  });
});

describe('PitchTargetSelector: scale and chromatic fallbacks', () => {
  it('snaps to the key when there is no melody', () => {
    const selector = selectorFor(targets([], C_MAJOR));
    expect(selector.select(61.4, 3)).toBe(62);
    expect(selector.source).toBe('scale');
    expect(selectOnce(targets([], { tonic: 9, mode: 'major', confidence: 1 }), 60.2, 3)).toEqual({
      target: 61,
      source: 'scale',
    });
  });

  it('snaps to the nearest semitone when there is no key', () => {
    expect(selectOnce(targets([], null), 61.4, 3)).toEqual({ target: 61, source: 'chromatic' });
    expect(selectOnce(targets([], null), 61.6, NO_CLOCK)).toEqual({
      target: 62,
      source: 'chromatic',
    });
  });

  it('snaps to the nearest semitone when there are no targets at all', () => {
    expect(selectOnce(null, 61.4, 3)).toEqual({ target: 61, source: 'chromatic' });
    const selector = selectorFor(SONG);
    selector.setTargets(null);
    expect(selector.select(61.3, 1.2)).toBe(61);
    expect(selector.source).toBe('chromatic');
  });

  it('uses the melody when out of the scale, and the scale when out of the melody', () => {
    // Melody note outside the key wins while the singer is near it…
    expect(selectOnce(SONG, 61.4, 1.2).target).toBe(61);
    // …and with a chromatic fallback when the song has no key.
    const noKey = targets([[1.0, 1.5, 61]], null);
    expect(selectOnce(noKey, 64.2, 1.2)).toEqual({ target: 64, source: 'chromatic' });
  });
});

describe('PitchTargetSelector: tuning offset', () => {
  it('places every kind of target on the song’s own tuning grid', () => {
    const sharp = targets([[1.0, 1.5, 61]], C_MAJOR, 30);
    // Melody note C♯ + 30 cents.
    expect(selectOnce(sharp, 61.2, 1.2).target).toBeCloseTo(61.3, 6);
    // Scale: D + 30 cents is nearer to 61.75 than C + 30 cents.
    expect(selectOnce(sharp, 61.75, 5).target).toBeCloseTo(62.3, 6);
    // Chromatic grid shifted by 30 cents: 59.75 is nearer to 59.3 than to 60.3.
    const sharpChromatic = targets([], null, 30);
    expect(selectOnce(sharpChromatic, 59.75, 5).target).toBeCloseTo(59.3, 6);
    expect(selectOnce(sharpChromatic, 59.85, 5).target).toBeCloseTo(60.3, 6);
    const flat = targets([], null, -40);
    expect(selectOnce(flat, 60.0, 5).target).toBeCloseTo(59.6, 6);
  });

  it('measures the melody pull range on the shifted grid', () => {
    const sharp = targets([[1.0, 1.5, 61]], null, 40);
    // The note really is at 61.4: 63.8 is 2.4 away (pulled), 64.0 is 2.6 away (not pulled).
    expect(selectOnce(sharp, 63.8, 1.2).source).toBe('melody');
    expect(selectOnce(sharp, 64.0, 1.2).source).toBe('chromatic');
  });
});

describe('PitchTargetSelector: hysteresis', () => {
  it('keeps a semitone target until the singer is clearly nearer to the next one', () => {
    const selector = selectorFor(null);
    expect(selector.select(60.4, NO_CLOCK)).toBe(60);
    expect(selector.select(60.55, NO_CLOCK)).toBe(60);
    expect(selector.select(60.59, NO_CLOCK)).toBe(60);
    expect(selector.select(60.65, NO_CLOCK)).toBe(61);
    // And it does not fall straight back.
    expect(selector.select(60.45, NO_CLOCK)).toBe(61);
    expect(selector.select(60.41, NO_CLOCK)).toBe(61);
    expect(selector.select(60.35, NO_CLOCK)).toBe(60);
  });

  it('never flip-flops for a pitch sitting on the boundary between two notes', () => {
    for (const first of [60.49, 60.51]) {
      const selector = selectorFor(null);
      const held = selector.select(first, NO_CLOCK);
      for (let i = 0; i < 200; i++) {
        const wobble = 60.5 + 0.09 * Math.sin(i * 1.7);
        expect(selector.select(wobble, NO_CLOCK)).toBe(held);
      }
    }
  });

  it('applies to scale notes', () => {
    const selector = selectorFor(targets([], C_MAJOR));
    expect(selector.select(60.9, NO_CLOCK)).toBe(60);
    expect(selector.select(61.05, NO_CLOCK)).toBe(60);
    expect(selector.select(61.15, NO_CLOCK)).toBe(62);
    expect(selector.select(60.95, NO_CLOCK)).toBe(62);
    expect(selector.select(60.85, NO_CLOCK)).toBe(60);
  });

  it('applies between two melody notes and at the edge of the pull range', () => {
    const selector = selectorFor(SONG);
    // Between C♯ and D around 1.5 s: holding C♯ past the midpoint.
    expect(selector.select(61.3, 1.5)).toBe(61);
    expect(selector.select(61.55, 1.5)).toBe(61);
    expect(selector.select(61.65, 1.5)).toBe(62);
    expect(selector.select(61.45, 1.5)).toBe(62);
    expect(selector.select(61.35, 1.5)).toBe(61);

    // Edge of the pull range: once pulled to the melody, a little further away is still held.
    const edge = selectorFor(SONG);
    expect(edge.select(63.4, 1.2)).toBe(61);
    expect(edge.select(63.65, 1.2)).toBe(61);
    expect(edge.source).toBe('melody');
    expect(edge.select(63.75, 1.2)).toBe(64);
    expect(edge.source).toBe('scale');
    // And from outside it takes more than touching the edge to be pulled in again.
    expect(edge.select(63.6, 1.2)).toBe(64);
  });

  it('lets the melody replace a held scale note as soon as it is in range', () => {
    const selector = selectorFor(SONG);
    expect(selector.select(62.2, 2.25)).toBe(62);
    expect(selector.source).toBe('scale');
    // The next melody note (G, 67) is too far: still the scale.
    expect(selector.select(62.2, 2.6)).toBe(62);
    // Back where D is the melody note.
    expect(selector.select(62.2, 1.8)).toBe(62);
    expect(selector.source).toBe('melody');
  });

  it('returns NaN for a sung pitch that is not finite, and keeps the held note', () => {
    const selector = selectorFor(SONG);
    expect(selector.select(60.55, NO_CLOCK)).toBe(60);
    for (const sung of [Infinity, -Infinity, Number.NaN]) {
      expect(selector.select(sung, 1.2)).toBeNaN();
      expect(selector.select(sung, NO_CLOCK)).toBeNaN();
    }
    // Still holding 60: 60.55 is past the plain midpoint but inside the hysteresis.
    expect(selector.select(60.55, NO_CLOCK)).toBe(60);
  });

  it('forgets the held note on reset and when the targets change', () => {
    const selector = selectorFor(null);
    expect(selector.select(60.4, NO_CLOCK)).toBe(60);
    expect(selector.select(60.55, NO_CLOCK)).toBe(60);
    selector.reset();
    expect(selector.select(60.55, NO_CLOCK)).toBe(61);
    expect(selector.select(60.45, NO_CLOCK)).toBe(61);
    selector.setTargets(null);
    expect(selector.select(60.45, NO_CLOCK)).toBe(60);
  });
});
