import { beforeAll, describe, expect, it } from 'vitest';
import { estimateAlignment } from './alignment';
import type { RenderedSong } from './testing/renderSong';
import { makeSong, offsetBy, silence, toMono, whiteNoise } from './testing/signals';

// The "reference" is a full mix; the "backing track" is the instrumental of the same
// performance, cut or padded so that referenceTime = backingTime + offset.
const SONG = { seed: 60, durationSec: 30, tempoBpm: 104, tonic: 2 } as const;

let song: RenderedSong;
beforeAll(() => {
  song = makeSong(SONG, { sampleRate: 44_100 });
});

describe('estimateAlignment: instrumental against its own full mix', () => {
  it.each([0, 1.2345, -0.777, 3.5, -2.25, 0.013, 12.5, -19.75])(
    'recovers an offset of %f s',
    (offsetSec) => {
      const estimate = estimateAlignment(offsetBy(song.instrumental, offsetSec), song.mix);
      expect(Math.abs(estimate.offsetSec - offsetSec)).toBeLessThan(0.005);
      expect(estimate.confidence).toBeGreaterThan(0.9);
    },
  );

  it('works across sample rates and with a louder vocal on top', () => {
    const backing = makeSong(SONG, { sampleRate: 48_000 }).instrumental;
    const reference = makeSong(SONG, { sampleRate: 32_000, vocalGainDb: 6, reverb: true }).mix;
    const estimate = estimateAlignment(offsetBy(backing, 1.5), reference);
    expect(Math.abs(estimate.offsetSec - 1.5)).toBeLessThan(0.01);
    expect(estimate.confidence).toBeGreaterThan(0.8);
  });

  it('works with mono files and a different playback level', () => {
    const backing = toMono(offsetBy(song.instrumental, -1));
    const quiet = { ...backing, left: backing.left.map((sample) => 0.1 * sample) };
    const estimate = estimateAlignment(quiet, toMono(song.mix));
    expect(Math.abs(estimate.offsetSec + 1)).toBeLessThan(0.005);
    expect(estimate.confidence).toBeGreaterThan(0.9);
  });

  it('works when the backing track is only part of the song', () => {
    const excerpt = offsetBy(song.instrumental, 4);
    const shortened = {
      left: excerpt.left.subarray(0, 18 * 44_100),
      right: excerpt.right!.subarray(0, 18 * 44_100),
      sampleRate: 44_100,
    };
    const estimate = estimateAlignment(shortened, song.mix);
    expect(Math.abs(estimate.offsetSec - 4)).toBeLessThan(0.005);
    expect(estimate.confidence).toBeGreaterThan(0.8);
  });

  it('is not confident when the true offset lies outside the searched range', () => {
    const estimate = estimateAlignment(offsetBy(song.instrumental, 6), song.mix, {
      maxOffsetSec: 2,
    });
    expect(Math.abs(estimate.offsetSec)).toBeLessThanOrEqual(2.01);
    expect(estimate.confidence).toBeLessThan(0.5);
  });
});

describe('estimateAlignment: material that does not belong together', () => {
  it('has no confidence for a different song at a different tempo', () => {
    const other = makeSong({ seed: 61, durationSec: 30, tempoBpm: 121, tonic: 7, mode: 'minor' });
    expect(estimateAlignment(other.instrumental, song.mix).confidence).toBeLessThan(0.1);
    expect(estimateAlignment(other.mix, song.mix).confidence).toBeLessThan(0.1);
  });

  it('has little confidence for a different song at the same tempo with the same drum pattern', () => {
    const sameTempo = makeSong({
      seed: 62,
      durationSec: 30,
      tempoBpm: 104,
      tonic: 9,
      vocalRange: 'male',
    });
    const sameTempoAndKey = makeSong({ seed: 63, durationSec: 30, tempoBpm: 104, tonic: 2 });
    expect(estimateAlignment(sameTempo.instrumental, song.mix).confidence).toBeLessThan(0.25);
    expect(estimateAlignment(sameTempoAndKey.instrumental, song.mix).confidence).toBeLessThan(0.25);
  });

  it('has no confidence for noise or silence, and does not fail on them', () => {
    expect(estimateAlignment(whiteNoise(20, 44_100, 9), song.mix).confidence).toBeLessThan(0.1);
    expect(estimateAlignment(silence(20, 44_100), song.mix)).toEqual({
      offsetSec: 0,
      confidence: 0,
    });
    expect(estimateAlignment(song.mix, silence(20, 44_100))).toEqual({
      offsetSec: 0,
      confidence: 0,
    });
  });

  it('declines recordings too short to align', () => {
    const snippet = {
      left: song.mix.left.subarray(0, 2 * 44_100),
      right: null,
      sampleRate: 44_100,
    };
    expect(estimateAlignment(snippet, song.mix)).toEqual({ offsetSec: 0, confidence: 0 });
    const empty = { left: new Float32Array(0), right: null, sampleRate: 44_100 };
    expect(estimateAlignment(empty, song.mix)).toEqual({ offsetSec: 0, confidence: 0 });
  });

  it('rejects an invalid sample rate', () => {
    const broken = { left: new Float32Array(1000), right: null, sampleRate: -1 };
    expect(() => estimateAlignment(broken, song.mix)).toThrow(RangeError);
  });

  it('hands out a fresh result each time it declines', () => {
    const first = estimateAlignment(silence(20, 44_100), song.mix);
    first.offsetSec = 7;
    first.confidence = 0.99;
    expect(estimateAlignment(silence(20, 44_100), song.mix)).toEqual({
      offsetSec: 0,
      confidence: 0,
    });
  });
});

describe('estimateAlignment: search range', () => {
  it('rejects a negative or NaN maximum offset', () => {
    const backing = offsetBy(song.instrumental, 1);
    expect(() => estimateAlignment(backing, song.mix, { maxOffsetSec: -5 })).toThrow(RangeError);
    expect(() => estimateAlignment(backing, song.mix, { maxOffsetSec: Number.NaN })).toThrow(
      RangeError,
    );
  });

  it('limits a huge maximum offset to what the recordings allow', () => {
    // Without the limit the score array alone would need about 1.6 TB.
    const backing = offsetBy(song.instrumental, -2.5);
    for (const maxOffsetSec of [1e9, Number.POSITIVE_INFINITY]) {
      const estimate = estimateAlignment(backing, song.mix, { maxOffsetSec });
      expect(Math.abs(estimate.offsetSec + 2.5)).toBeLessThan(0.005);
      expect(estimate.confidence).toBeGreaterThan(0.9);
    }
  });
});
