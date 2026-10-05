// Key detection over a contiguous sweep of songs (tonics in steps of a fourth, both modes, both
// voices) instead of hand-picked seeds. The bounds record what the estimator does today,
// including its known weakness: now and then a confident key one note away from the truth.
import { describe, expect, it } from 'vitest';
import { SCALE_INTERVALS, type KeyEstimate, type ScaleMode } from '@shared/music';
import { analyzeReference } from './analyzeReference';
import { MIN_KEY_CONFIDENCE } from './pitchTargets';
import { makeSong } from './testing/signals';

const SONG_COUNT = 16;

function scaleOf(tonic: number, mode: ScaleMode): string {
  return SCALE_INTERVALS[mode]
    .map((interval) => (tonic + interval) % 12)
    .sort((a, b) => a - b)
    .join(',');
}

interface Tally {
  exact: number;
  sameScale: number;
  confidentlyWrong: number;
}

function sweep(progressions: Record<ScaleMode, readonly number[]> | null): Tally {
  const tally: Tally = { exact: 0, sameScale: 0, confidentlyWrong: 0 };
  for (let index = 0; index < SONG_COUNT; index++) {
    const mode: ScaleMode = index % 2 === 0 ? 'major' : 'minor';
    const tonic = (index * 5) % 12;
    const song = makeSong(
      {
        seed: 200 + index,
        tonic,
        mode,
        vocalRange: index % 4 < 2 ? 'female' : 'male',
        ...(progressions ? { progression: progressions[mode] } : {}),
      },
      { sampleRate: 32_000 },
    );
    const key: KeyEstimate = analyzeReference(song.mix).key;
    const sameScale = scaleOf(key.tonic, key.mode) === scaleOf(tonic, mode);
    if (key.tonic === tonic && key.mode === mode) tally.exact++;
    if (sameScale) tally.sameScale++;
    else if (key.confidence >= MIN_KEY_CONFIDENCE) tally.confidentlyWrong++;
  }
  return tally;
}

describe('key over a sweep of songs', () => {
  it('finds tonic and mode of songs built on I-IV-V-I / i-iv-v-i', () => {
    const tally = sweep(null);
    expect(tally.exact).toBeGreaterThanOrEqual(SONG_COUNT - 2);
    expect(tally.confidentlyWrong).toBeLessThanOrEqual(1);
  });

  it('finds the scale of four-chord loops (I-V-vi-IV / i-VI-III-VII)', () => {
    const tally = sweep({ major: [0, 4, 5, 3], minor: [0, 5, 2, 6] });
    expect(tally.sameScale).toBeGreaterThanOrEqual(SONG_COUNT - 2);
    expect(tally.confidentlyWrong).toBeLessThanOrEqual(1);
  });
});
