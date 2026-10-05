// Key detection end to end, on synthetic songs (the profile maths is tested in
// keyEstimation.test.ts).
import { describe, expect, it } from 'vitest';
import { SCALE_INTERVALS, describeKey, type ScaleMode } from '@shared/music';
import { analyzeReference } from './analyzeReference';
import { MIN_KEY_CONFIDENCE } from './pitchTargets';
import { makeSong, toneSequence, whiteNoise } from './testing/signals';
import type { SongSpec } from './testing/songScore';

function scaleNotes(tonic: number, mode: ScaleMode): number[] {
  return SCALE_INTERVALS[mode].map((interval) => (tonic + interval) % 12).sort((a, b) => a - b);
}

function song(spec: Partial<SongSpec>) {
  return makeSong({ durationSec: 24, ...spec }, { sampleRate: 32_000 });
}

describe('key of synthetic songs', () => {
  // Progressions that establish their key: I-IV-V-I in major, i-iv-v-i in minor.
  const cases: (Partial<SongSpec> & { tonic: number; mode: ScaleMode })[] = [
    { seed: 100, tonic: 0, mode: 'major', vocalRange: 'male', tempoBpm: 96 },
    { seed: 101, tonic: 2, mode: 'major', vocalRange: 'female', tempoBpm: 100 },
    { seed: 103, tonic: 6, mode: 'major', vocalRange: 'female', tempoBpm: 108 },
    { seed: 105, tonic: 10, mode: 'major', vocalRange: 'female', tempoBpm: 116 },
    { seed: 119, tonic: 2, mode: 'minor', vocalRange: 'female', tempoBpm: 100 },
    { seed: 121, tonic: 6, mode: 'minor', vocalRange: 'female', tempoBpm: 108 },
    { seed: 122, tonic: 8, mode: 'minor', vocalRange: 'male', tempoBpm: 112 },
    { seed: 123, tonic: 10, mode: 'minor', vocalRange: 'female', tempoBpm: 116 },
  ];

  it.each(cases)('finds tonic and mode of a song in $tonic $mode (seed $seed)', (spec) => {
    const rendered = song(spec);
    const expected = describeKey({ tonic: spec.tonic, mode: spec.mode, confidence: 1 });

    const fromMix = analyzeReference(rendered.mix);
    expect(describeKey(fromMix.key)).toBe(expected);
    expect(fromMix.key.confidence).toBeGreaterThanOrEqual(MIN_KEY_CONFIDENCE);

    // Without a vocal the melody is graded poor and the chroma of the mix decides alone.
    const fromInstrumental = analyzeReference(rendered.instrumental);
    expect(fromInstrumental.quality).toBe('poor');
    expect(describeKey(fromInstrumental.key)).toBe(expected);
  });

  // Four-chord loops (I-vi-IV-V, I-V-vi-IV, i-VI-III-VII) use the same chords in a major key
  // and in its relative minor; which of the two is "the" key is a matter of emphasis that
  // pitch-class statistics cannot always decide. Both have the same seven notes, which is
  // all the autotune needs, so that is what is required here.
  const loops: (Partial<SongSpec> & { tonic: number; mode: ScaleMode })[] = [
    { seed: 108, tonic: 5, mode: 'major', vocalRange: 'male', progression: [0, 5, 3, 4] },
    { seed: 116, tonic: 10, mode: 'major', vocalRange: 'male', progression: [0, 4, 5, 3] },
    { seed: 130, tonic: 2, mode: 'minor', progression: [0, 5, 2, 6] },
    { seed: 133, tonic: 8, mode: 'minor', progression: [0, 5, 2, 6] },
  ];

  it.each(loops)('finds the scale of a four-chord loop in $tonic $mode (seed $seed)', (spec) => {
    const key = analyzeReference(song(spec).mix).key;
    expect(scaleNotes(key.tonic, key.mode)).toEqual(scaleNotes(spec.tonic, spec.mode));
  });
});

describe('key of material without one', () => {
  it('has no confidence for noise', () => {
    expect(analyzeReference(whiteNoise(12, 32_000, 5)).key.confidence).toBeLessThan(0.1);
    expect(analyzeReference(whiteNoise(12, 32_000, 6, true)).key.confidence).toBeLessThan(0.1);
  });

  it('has no confidence for twelve-tone music', () => {
    // A tone row and its transpositions: every pitch class exactly as often as any other.
    const row = [0, 11, 3, 4, 8, 7, 9, 5, 6, 1, 2, 10];
    const notes: number[] = [];
    for (let statement = 0; statement < 8; statement++) {
      for (const pitchClass of row) {
        notes.push(48 + ((pitchClass + 5 * statement) % 12) + 12 * (statement % 2));
      }
    }
    const analysis = analyzeReference(toneSequence(notes, 0.25, 22_050));
    expect(analysis.key.confidence).toBeLessThan(0.1);
  });

  it('is confident again for the same kind of tones playing a scale', () => {
    const phrase = [
      60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 64, 67, 72, 67, 64, 60,
    ];
    const analysis = analyzeReference(toneSequence([...phrase, ...phrase, ...phrase], 0.3, 22_050));
    expect(describeKey(analysis.key)).toBe('C major');
    expect(analysis.key.confidence).toBeGreaterThan(0.5);
  });
});
