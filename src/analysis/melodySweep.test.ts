// The melody assertions over a sweep of songs rather than a few hand-picked ones: keys, both
// voice ranges, tempos, sample rates and reverb all vary with the seed.
import { describe, expect, it } from 'vitest';
import { analyzeReference } from './analyzeReference';
import { scoreMelody, scoreNotes } from './testing/metrics';
import { makeSong } from './testing/signals';

interface SweepResult {
  quality: string;
  rawPitchAccuracy: number;
  octaveErrors: number;
  falseAlarms: number;
  noteRecall: number;
  notePrecision: number;
}

function sweep(count: number, firstSeed: number, vocalGainDb: number): SweepResult[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = firstSeed + 37 * index;
    const song = makeSong(
      {
        seed,
        tonic: (seed * 7) % 12,
        mode: index % 3 === 0 ? 'minor' : 'major',
        vocalRange: index % 2 === 1 ? 'female' : 'male',
        tempoBpm: 90 + ((index * 7) % 40),
      },
      {
        sampleRate: [32_000, 44_100, 48_000][index % 3]!,
        reverb: index % 4 === 1,
        vocalGainDb,
      },
    );
    const analysis = analyzeReference(song.mix);
    const melody = scoreMelody(song.truth, analysis.contour.f0Hz, analysis.contour.hopSec);
    const notes = scoreNotes(song.truth.notes, analysis.notes);
    return {
      quality: analysis.quality,
      rawPitchAccuracy: melody.rawPitchAccuracy,
      octaveErrors: melody.rawChromaAccuracy - melody.rawPitchAccuracy,
      falseAlarms: melody.voicingFalseAlarm,
      noteRecall: notes.recall,
      notePrecision: notes.precision,
    };
  });
}

function mean(results: SweepResult[], pick: (result: SweepResult) => number): number {
  return results.reduce((sum, result) => sum + pick(result), 0) / results.length;
}

function worst(
  results: SweepResult[],
  pick: (result: SweepResult) => number,
  direction: 'min' | 'max',
): number {
  const values = results.map(pick);
  return direction === 'min' ? Math.min(...values) : Math.max(...values);
}

describe('melody over a sweep of songs', () => {
  it('finds a lead vocal as loud as the band in 12 songs', () => {
    const results = sweep(12, 9000, 0);
    expect(results.map((result) => result.quality)).toEqual(new Array(12).fill('good'));
    expect(mean(results, (r) => r.rawPitchAccuracy)).toBeGreaterThan(0.95);
    expect(worst(results, (r) => r.rawPitchAccuracy, 'min')).toBeGreaterThan(0.9);
    expect(mean(results, (r) => r.octaveErrors)).toBeLessThan(0.02);
    expect(worst(results, (r) => r.octaveErrors, 'max')).toBeLessThan(0.08);
    expect(mean(results, (r) => r.falseAlarms)).toBeLessThan(0.03);
    expect(worst(results, (r) => r.falseAlarms, 'max')).toBeLessThan(0.05);
    expect(mean(results, (r) => r.noteRecall)).toBeGreaterThan(0.9);
    expect(mean(results, (r) => r.notePrecision)).toBeGreaterThan(0.9);
  });

  it('finds most of a lead vocal 3 dB below the band in 8 songs, with few false alarms', () => {
    const results = sweep(8, 9500, -3);
    expect(results.every((result) => result.quality !== 'poor')).toBe(true);
    expect(mean(results, (r) => r.rawPitchAccuracy)).toBeGreaterThan(0.8);
    expect(worst(results, (r) => r.rawPitchAccuracy, 'min')).toBeGreaterThan(0.7);
    expect(mean(results, (r) => r.falseAlarms)).toBeLessThan(0.03);
    expect(mean(results, (r) => r.noteRecall)).toBeGreaterThan(0.75);
  });
});
