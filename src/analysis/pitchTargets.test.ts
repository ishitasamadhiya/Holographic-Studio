import { describe, expect, it } from 'vitest';
import {
  REFERENCE_ANALYSIS_SCHEMA_VERSION,
  type MelodyQuality,
  type ReferenceAnalysis,
} from '@shared/music';
import { MIN_ALIGNMENT_CONFIDENCE, MIN_KEY_CONFIDENCE, buildPitchTargets } from './pitchTargets';

function analysisWith(overrides: Partial<ReferenceAnalysis> = {}): ReferenceAnalysis {
  return {
    schemaVersion: REFERENCE_ANALYSIS_SCHEMA_VERSION,
    durationSec: 10,
    contour: { hopSec: 0.01, f0Hz: [], confidence: [] },
    notes: [
      { startSec: 1, endSec: 1.5, midi: 60, confidence: 0.9 },
      { startSec: 1.5, endSec: 2.25, midi: 62, confidence: 0.8 },
      { startSec: 4, endSec: 5, midi: 67, confidence: 0.7 },
    ],
    key: { tonic: 0, mode: 'major', confidence: 0.9 },
    tuningCents: 12.5,
    quality: 'good',
    stats: { voicedRatio: 0.3, meanConfidence: 0.8, noteCount: 3 },
    ...overrides,
  };
}

const confident = { offsetSec: 0, confidence: 1 };

describe('buildPitchTargets', () => {
  it('passes the notes through unshifted when the caller asserts the files are aligned', () => {
    const targets = buildPitchTargets(analysisWith(), { hasSongClock: true, alignment: null });
    expect(targets.notes).toBeInstanceOf(Float32Array);
    expect(Array.from(targets.notes)).toEqual([1, 1.5, 60, 1.5, 2.25, 62, 4, 5, 67]);
    expect(targets.key).toEqual({ tonic: 0, mode: 'major', confidence: 0.9 });
    expect(targets.tuningCents).toBe(12.5);
  });

  it.each<MelodyQuality>(['good', 'fair'])('uses a %s melody', (quality) => {
    const targets = buildPitchTargets(analysisWith({ quality }), {
      hasSongClock: true,
      alignment: confident,
    });
    expect(targets.notes.length).toBe(9);
  });

  it('never uses a poor melody, but still passes on key and tuning', () => {
    const targets = buildPitchTargets(analysisWith({ quality: 'poor' }), {
      hasSongClock: true,
      alignment: confident,
    });
    expect(targets.notes.length).toBe(0);
    expect(targets.key?.tonic).toBe(0);
    expect(targets.tuningCents).toBe(12.5);
  });

  it('drops the melody when there is no song clock to follow it on', () => {
    for (const alignment of [null, confident]) {
      const targets = buildPitchTargets(analysisWith(), { hasSongClock: false, alignment });
      expect(targets.notes.length).toBe(0);
      expect(targets.key).not.toBeNull();
    }
  });

  it('drops the melody when the alignment is not confident enough', () => {
    const below = { offsetSec: 1, confidence: MIN_ALIGNMENT_CONFIDENCE - 0.01 };
    const at = { offsetSec: 1, confidence: MIN_ALIGNMENT_CONFIDENCE };
    expect(
      buildPitchTargets(analysisWith(), { hasSongClock: true, alignment: below }).notes.length,
    ).toBe(0);
    expect(
      buildPitchTargets(analysisWith(), { hasSongClock: true, alignment: at }).notes.length,
    ).toBe(9);
  });

  it('shifts notes from reference time into song time (song = reference - offset)', () => {
    const later = buildPitchTargets(analysisWith(), {
      hasSongClock: true,
      alignment: { offsetSec: 0.75, confidence: 0.9 },
    });
    expect(Array.from(later.notes)).toEqual([0.25, 0.75, 60, 0.75, 1.5, 62, 3.25, 4.25, 67]);

    const earlier = buildPitchTargets(analysisWith(), {
      hasSongClock: true,
      alignment: { offsetSec: -2, confidence: 0.9 },
    });
    expect(Array.from(earlier.notes)).toEqual([3, 3.5, 60, 3.5, 4.25, 62, 6, 7, 67]);
  });

  it('drops notes before the start of the backing track and trims one that straddles it', () => {
    const targets = buildPitchTargets(analysisWith(), {
      hasSongClock: true,
      alignment: { offsetSec: 1.75, confidence: 0.9 },
    });
    expect(Array.from(targets.notes)).toEqual([0, 0.5, 62, 2.25, 3.25, 67]);
  });

  it('returns triples sorted by start time even if the analysis is not', () => {
    const analysis = analysisWith();
    analysis.notes.reverse();
    const targets = buildPitchTargets(analysis, { hasSongClock: true, alignment: null });
    const starts = Array.from(targets.notes).filter((_, index) => index % 3 === 0);
    expect(starts).toEqual([1, 1.5, 4]);
    expect(targets.notes.length % 3).toBe(0);
  });

  it('falls back to chromatic snapping (key null) when the key is uncertain', () => {
    const uncertain = analysisWith({
      key: { tonic: 4, mode: 'minor', confidence: MIN_KEY_CONFIDENCE - 0.01 },
    });
    const targets = buildPitchTargets(uncertain, { hasSongClock: true, alignment: null });
    expect(targets.key).toBeNull();
    expect(targets.notes.length).toBe(9);

    const justEnough = analysisWith({
      key: { tonic: 4, mode: 'minor', confidence: MIN_KEY_CONFIDENCE },
    });
    expect(buildPitchTargets(justEnough, { hasSongClock: false, alignment: null }).key).toEqual({
      tonic: 4,
      mode: 'minor',
      confidence: MIN_KEY_CONFIDENCE,
    });
  });

  it('does not hand out the analysis object itself', () => {
    const analysis = analysisWith();
    const targets = buildPitchTargets(analysis, { hasSongClock: true, alignment: null });
    expect(targets.key).not.toBe(analysis.key);
  });
});
