// End-to-end tests of the reference analysis on synthetic songs with known ground truth.
// The songs are deliberately unkind (see testing/renderSong.ts): accompaniment as loud as the
// voice or louder, bass one to two octaves below the melody and dead centre, pad and arpeggio
// inside the vocal range, a noisy snare in the centre.
import { beforeAll, describe, expect, it } from 'vitest';
import { isReferenceAnalysis, type ReferenceAnalysis } from '@shared/music';
import { analyzeReference } from './analyzeReference';
import * as publicApi from './index';
import { scoreMelody, scoreNotes, type MelodyScores, type NoteScores } from './testing/metrics';
import type { RenderOptions, RenderedSong } from './testing/renderSong';
import { makeSong, silence, toMono, whiteNoise } from './testing/signals';
import type { SongSpec } from './testing/songScore';

interface Case {
  name: string;
  spec: Partial<SongSpec>;
  render: Partial<RenderOptions>;
}

interface Outcome {
  song: RenderedSong;
  analysis: ReferenceAnalysis;
  melody: MelodyScores;
  notes: NoteScores;
}

function run(testCase: Case): Outcome {
  const song = makeSong(testCase.spec, testCase.render);
  const analysis = analyzeReference(song.mix);
  return {
    song,
    analysis,
    melody: scoreMelody(song.truth, analysis.contour.f0Hz, analysis.contour.hopSec),
    notes: scoreNotes(song.truth.notes, analysis.notes),
  };
}

function octaveErrorRate(scores: MelodyScores): number {
  return scores.rawChromaAccuracy - scores.rawPitchAccuracy;
}

/** Of the sung frames the analysis reported a pitch for, the share with the right pitch. */
function pitchPrecision(scores: MelodyScores): number {
  return scores.rawPitchAccuracy / scores.voicingRecall;
}

const CLEAR: Case[] = [
  {
    name: 'female voice as loud as the band (44.1 kHz)',
    spec: { seed: 11, vocalRange: 'female', tonic: 0, mode: 'major' },
    render: { sampleRate: 44_100, vocalGainDb: 0 },
  },
  {
    name: 'male voice as loud as the band, with reverb (48 kHz)',
    spec: { seed: 12, vocalRange: 'male', tonic: 9, mode: 'minor' },
    render: { sampleRate: 48_000, vocalGainDb: 0, reverb: true },
  },
  {
    name: 'female voice 6 dB above the band, with reverb',
    spec: { seed: 13, vocalRange: 'female', tonic: 7, mode: 'major' },
    render: { sampleRate: 32_000, vocalGainDb: 6, reverb: true },
  },
  {
    name: 'male voice 3 dB above the band',
    spec: { seed: 14, vocalRange: 'male', tonic: 4, mode: 'major' },
    render: { sampleRate: 32_000, vocalGainDb: 3 },
  },
];

const QUIET: Case[] = [
  {
    name: 'female voice 3 dB below the band',
    spec: { seed: 15, vocalRange: 'female', tonic: 2, mode: 'minor' },
    render: { sampleRate: 32_000, vocalGainDb: -3 },
  },
  {
    name: 'male voice 3 dB below the band',
    spec: { seed: 16, vocalRange: 'male', tonic: 5, mode: 'major' },
    render: { sampleRate: 32_000, vocalGainDb: -3 },
  },
];

const BURIED: Case[] = [
  {
    name: 'female voice 6 dB below the band',
    spec: { seed: 17, vocalRange: 'female', tonic: 10, mode: 'major' },
    render: { sampleRate: 32_000, vocalGainDb: -6 },
  },
  {
    name: 'male voice 6 dB below the band',
    spec: { seed: 18, vocalRange: 'male', tonic: 3, mode: 'minor' },
    render: { sampleRate: 32_000, vocalGainDb: -6 },
  },
];

describe('melody of a clearly audible lead vocal', () => {
  it.each(CLEAR)('$name', (testCase) => {
    const { analysis, melody, notes } = run(testCase);
    expect(melody.rawPitchAccuracy, 'raw pitch accuracy').toBeGreaterThan(0.9);
    expect(melody.voicingRecall, 'voicing recall').toBeGreaterThan(0.9);
    expect(melody.voicingFalseAlarm, 'voicing false alarms').toBeLessThan(0.05);
    expect(octaveErrorRate(melody), 'octave errors').toBeLessThan(0.03);
    expect(Math.abs(melody.meanErrorCents), 'pitch bias in cents').toBeLessThan(5);
    expect(notes.recall, 'note recall').toBeGreaterThanOrEqual(0.85);
    expect(notes.precision, 'note precision').toBeGreaterThanOrEqual(0.85);
    expect(analysis.quality).toBe('good');
    expect(Math.abs(analysis.tuningCents)).toBeLessThan(4);
  });
});

describe('melody of a lead vocal below the level of its accompaniment', () => {
  it.each(QUIET)('$name', (testCase) => {
    const { analysis, melody, notes } = run(testCase);
    expect(melody.rawPitchAccuracy, 'raw pitch accuracy').toBeGreaterThan(0.7);
    expect(melody.voicingFalseAlarm, 'voicing false alarms').toBeLessThan(0.08);
    expect(octaveErrorRate(melody), 'octave errors').toBeLessThan(0.05);
    expect(pitchPrecision(melody), 'pitch precision').toBeGreaterThan(0.9);
    expect(notes.recall, 'note recall').toBeGreaterThanOrEqual(0.6);
    expect(analysis.quality).not.toBe('poor');
  });

  // 6 dB down the voice holds a fifth of the vocal band's power: much of it is missed. What
  // must hold is that the analysis then reports LESS, not garbage, and does not call it good
  // when it found less than half.
  it.each(BURIED)('$name: reports less rather than wrong', (testCase) => {
    const { analysis, melody } = run(testCase);
    expect(melody.voicingFalseAlarm, 'voicing false alarms').toBeLessThan(0.08);
    expect(pitchPrecision(melody), 'pitch precision').toBeGreaterThan(0.9);
    if (melody.voicingRecall < 0.6) expect(analysis.quality).not.toBe('good');
  });
});

describe('tuning offset', () => {
  it.each([
    { tuningCents: 25, spec: { seed: 19, vocalRange: 'female', tonic: 0, mode: 'major' } },
    { tuningCents: -30, spec: { seed: 20, vocalRange: 'male', tonic: 6, mode: 'minor' } },
    { tuningCents: 45, spec: { seed: 21, vocalRange: 'female', tonic: 8, mode: 'major' } },
  ] as const)(
    'a song rendered $tuningCents cents off is measured and its notes keep their numbers',
    (testCase) => {
      const { analysis, notes, song } = run({
        name: 'detuned',
        spec: testCase.spec,
        render: { sampleRate: 32_000, tuningCents: testCase.tuningCents },
      });
      expect(Math.abs(analysis.tuningCents - testCase.tuningCents)).toBeLessThan(3);
      // Ground-truth notes are the MIDI numbers that were "meant", before detuning.
      expect(notes.recall).toBeGreaterThanOrEqual(0.85);
      expect(analysis.key.tonic).toBe(song.truth.key.tonic);
      expect(analysis.key.mode).toBe(song.truth.key.mode);
    },
  );

  it('is measured from the instruments alone when nobody sings', () => {
    const song = makeSong({ seed: 19 }, { sampleRate: 32_000, tuningCents: -20 });
    const analysis = analyzeReference(song.instrumental);
    expect(analysis.quality).toBe('poor');
    expect(Math.abs(analysis.tuningCents + 20)).toBeLessThan(6);
  });
});

describe('quality grade', () => {
  let song: RenderedSong;
  beforeAll(() => {
    song = makeSong(CLEAR[0]!.spec, CLEAR[0]!.render);
  });

  it('grades instrumental versions poor and finds next to no melody in them', () => {
    for (const testCase of CLEAR.slice(0, 2)) {
      const instrumental = analyzeReference(makeSong(testCase.spec, testCase.render).instrumental);
      expect(instrumental.quality).toBe('poor');
      expect(instrumental.stats.voicedRatio).toBeLessThan(0.05);
    }
  });

  it('grades noise and silence poor', () => {
    for (const pcm of [
      whiteNoise(12, 44_100, 5),
      whiteNoise(12, 44_100, 6, true),
      silence(6, 44_100),
    ]) {
      const analysis = analyzeReference(pcm);
      expect(analysis.quality).toBe('poor');
      expect(analysis.notes).toEqual([]);
      expect(analysis.stats.voicedRatio).toBe(0);
      expect(analysis.tuningCents).toBe(0);
    }
  });

  it('grades a bass line poor, alone with the drums or under quiet chords', () => {
    // The bass is centred, so the centre emphasis keeps it; it is rejected for its register.
    for (const chordsDb of [null, -20, -12]) {
      const groove = makeSong(CLEAR[0]!.spec, {
        ...CLEAR[0]!.render,
        includeVocal: false,
        stemLevelsDb: { pads: chordsDb, arpeggio: chordsDb },
      });
      const analysis = analyzeReference(groove.mix);
      expect(analysis.quality, `chords at ${chordsDb} dB`).toBe('poor');
      expect(analysis.stats.voicedRatio, `chords at ${chordsDb} dB`).toBeLessThan(0.02);
    }
  });

  it('finds key and tuning of mono material, with or without a vocal', () => {
    // The melody of mono material is covered in accompanimentLayouts.test.ts.
    const mono = toMono(song.mix);
    const dualMono = { ...mono, right: mono.left };
    for (const pcm of [mono, toMono(song.instrumental), dualMono]) {
      const analysis = analyzeReference(pcm);
      expect(analysis.key.tonic).toBe(0);
      expect(analysis.key.mode).toBe('major');
      expect(Math.abs(analysis.tuningCents)).toBeLessThan(4);
    }
  });

  it('grades an unaccompanied voice with a little stereo reverb good', () => {
    const aCappella = makeSong(CLEAR[0]!.spec, {
      ...CLEAR[0]!.render,
      reverb: true,
      stemLevelsDb: { pads: null, arpeggio: null, bass: null, drums: null },
    });
    const analysis = analyzeReference(aCappella.mix);
    const melody = scoreMelody(aCappella.truth, analysis.contour.f0Hz, analysis.contour.hopSec);
    expect(analysis.quality).toBe('good');
    expect(melody.rawPitchAccuracy).toBeGreaterThan(0.95);
  });
});

describe('shape of the result', () => {
  let song: RenderedSong;
  let analysis: ReferenceAnalysis;
  const progress: number[] = [];

  beforeAll(() => {
    song = makeSong(CLEAR[0]!.spec, CLEAR[0]!.render);
    analysis = analyzeReference(song.mix, { onProgress: (fraction) => progress.push(fraction) });
  });

  it('is plain data that survives a JSON round trip unchanged', () => {
    const revived: unknown = JSON.parse(JSON.stringify(analysis));
    expect(revived).toEqual(analysis);
    expect(isReferenceAnalysis(revived)).toBe(true);
    expect(isReferenceAnalysis(analysis)).toBe(true);
    expect(Array.isArray(analysis.contour.f0Hz)).toBe(true);
  });

  it('has a contour that covers the whole song at a steady hop', () => {
    const { hopSec, f0Hz, confidence } = analysis.contour;
    expect(f0Hz.length).toBe(confidence.length);
    expect(hopSec).toBe(0.01);
    expect(analysis.durationSec).toBeCloseTo(song.mix.left.length / song.mix.sampleRate, 9);
    expect(Math.abs(f0Hz.length * hopSec - analysis.durationSec)).toBeLessThanOrEqual(hopSec);
  });

  it('keeps every value finite and inside its documented range', () => {
    const { f0Hz, confidence } = analysis.contour;
    f0Hz.forEach((hz, frame) => {
      expect(Number.isFinite(hz)).toBe(true);
      expect(confidence[frame]!).toBeGreaterThanOrEqual(0);
      expect(confidence[frame]!).toBeLessThanOrEqual(1);
      if (hz === 0) expect(confidence[frame]).toBe(0);
      else {
        expect(hz).toBeGreaterThan(70);
        expect(hz).toBeLessThan(1200);
        expect(confidence[frame]!).toBeGreaterThan(0);
      }
    });
    expect(analysis.tuningCents).toBeGreaterThanOrEqual(-50);
    expect(analysis.tuningCents).toBeLessThanOrEqual(50);
    expect(analysis.key.tonic).toBeGreaterThanOrEqual(0);
    expect(analysis.key.tonic).toBeLessThan(12);
    expect(analysis.key.confidence).toBeGreaterThanOrEqual(0);
    expect(analysis.key.confidence).toBeLessThanOrEqual(1);
  });

  it('lists notes in order, without overlaps, inside the song, on integer MIDI numbers', () => {
    expect(analysis.notes.length).toBeGreaterThan(10);
    let previousEnd = 0;
    for (const note of analysis.notes) {
      expect(Number.isInteger(note.midi)).toBe(true);
      expect(note.startSec).toBeGreaterThanOrEqual(previousEnd);
      expect(note.endSec - note.startSec).toBeGreaterThanOrEqual(0.08 - 1e-9);
      expect(note.endSec).toBeLessThanOrEqual(analysis.durationSec + analysis.contour.hopSec);
      expect(note.confidence).toBeGreaterThan(0);
      expect(note.confidence).toBeLessThanOrEqual(1);
      previousEnd = note.endSec;
    }
  });

  it('reports statistics that agree with the contour and the notes', () => {
    const voiced = analysis.contour.f0Hz.filter((hz) => hz > 0).length;
    expect(analysis.stats.noteCount).toBe(analysis.notes.length);
    expect(analysis.stats.voicedRatio).toBeCloseTo(voiced / analysis.contour.f0Hz.length, 3);
    expect(analysis.stats.meanConfidence).toBeGreaterThan(0.5);
    expect(analysis.stats.meanConfidence).toBeLessThanOrEqual(1);
  });

  it('reports progress regularly, from 0 to 1, never going backwards', () => {
    expect(progress.length).toBeGreaterThan(20);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    for (let index = 1; index < progress.length; index++) {
      expect(progress[index]!).toBeGreaterThanOrEqual(progress[index - 1]!);
    }
    // No long silence: the largest single step is the resampling of one channel.
    const largestStep = Math.max(
      ...progress.slice(1).map((value, index) => value - progress[index]!),
    );
    expect(largestStep).toBeLessThan(0.1);
  });

  it('is deterministic', () => {
    expect(analyzeReference(song.mix)).toEqual(analysis);
  });

  it('does not modify its input', () => {
    const left = song.mix.left.slice();
    analyzeReference({ ...song.mix, left: song.mix.left.subarray(0, 44_100 * 3) });
    expect(song.mix.left).toEqual(left);
  });
});

describe('awkward input', () => {
  it('returns an empty, poor analysis for no audio at all', () => {
    const analysis = analyzeReference({
      left: new Float32Array(0),
      right: null,
      sampleRate: 48_000,
    });
    expect(analysis.durationSec).toBe(0);
    expect(analysis.contour.f0Hz).toEqual([]);
    expect(analysis.contour.confidence).toEqual([]);
    expect(analysis.notes).toEqual([]);
    expect(analysis.quality).toBe('poor');
    expect(isReferenceAnalysis(JSON.parse(JSON.stringify(analysis)))).toBe(true);
  });

  it('handles a clip shorter than one analysis window', () => {
    const analysis = analyzeReference({
      left: new Float32Array(300).fill(0.1),
      right: null,
      sampleRate: 48_000,
    });
    expect(analysis.quality).toBe('poor');
    expect(analysis.contour.f0Hz.length).toBeLessThanOrEqual(1);
  });

  it('uses the common length when the two channels differ in length', () => {
    const left = whiteNoise(2, 16_000, 1, true).left;
    const analysis = analyzeReference({
      left,
      right: left.subarray(0, 16_000),
      sampleRate: 16_000,
    });
    expect(analysis.durationSec).toBe(1);
    expect(analysis.contour.f0Hz.length).toBe(100);
  });

  it('treats non-finite samples as silence instead of spreading NaN', () => {
    const song = makeSong(CLEAR[3]!.spec, CLEAR[3]!.render);
    const damaged = song.mix.left.slice();
    damaged.fill(Number.NaN, 32_000 * 10, 32_000 * 10 + 500);
    damaged[32_000 * 15] = Number.POSITIVE_INFINITY;
    const analysis = analyzeReference({ ...song.mix, left: damaged });
    const serialised = JSON.stringify(analysis);
    expect(serialised).not.toContain('null');
    expect(analysis.quality).toBe('good');
    const melody = scoreMelody(song.truth, analysis.contour.f0Hz, analysis.contour.hopSec);
    expect(melody.rawPitchAccuracy).toBeGreaterThan(0.9);
  });

  it('copes with absurdly scaled float samples (a corrupt file) without overflowing', () => {
    const song = makeSong(CLEAR[3]!.spec, CLEAR[3]!.render);
    const scale = (channel: Float32Array) => channel.map((sample) => sample * 1e18);
    const analysis = analyzeReference({
      ...song.mix,
      left: scale(song.mix.left),
      right: scale(song.mix.right!),
    });
    expect(isReferenceAnalysis(JSON.parse(JSON.stringify(analysis)))).toBe(true);
    expect(Number.isFinite(analysis.tuningCents)).toBe(true);
    expect(analysis.quality).toBe('good');
    const melody = scoreMelody(song.truth, analysis.contour.f0Hz, analysis.contour.hopSec);
    expect(melody.rawPitchAccuracy).toBeGreaterThan(0.9);
  });

  it('rejects an invalid sample rate', () => {
    const left = new Float32Array(1000);
    expect(() => analyzeReference({ left, right: null, sampleRate: 0 })).toThrow(RangeError);
    expect(() => analyzeReference({ left, right: null, sampleRate: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe('public API', () => {
  it('exports the documented entry points from index.ts', () => {
    expect(publicApi.analyzeReference).toBe(analyzeReference);
    expect(typeof publicApi.estimateAlignment).toBe('function');
    expect(typeof publicApi.buildPitchTargets).toBe('function');
    expect(typeof publicApi.createAnalysisClient).toBe('function');
    expect(publicApi.MIN_ALIGNMENT_CONFIDENCE).toBeGreaterThan(0);
    expect(publicApi.MIN_KEY_CONFIDENCE).toBeGreaterThan(0);
  });

  it('turns an analysis and an alignment into pitch targets on the backing track’s clock', () => {
    const song = makeSong(CLEAR[3]!.spec, CLEAR[3]!.render);
    const analysis = publicApi.analyzeReference(song.mix);
    const backing = {
      left: song.instrumental.left.slice(32_000),
      right: song.instrumental.right!.slice(32_000),
      sampleRate: 32_000,
    };
    const alignment = publicApi.estimateAlignment(backing, song.mix);
    const targets = publicApi.buildPitchTargets(analysis, { hasSongClock: true, alignment });

    expect(alignment.offsetSec).toBeCloseTo(1, 2);
    expect(targets.notes.length).toBe(analysis.notes.length * 3);
    expect(targets.notes[0]).toBeCloseTo(analysis.notes[0]!.startSec - 1, 2);
    expect(targets.notes[2]).toBe(analysis.notes[0]!.midi);
    expect(targets.key).toEqual(analysis.key);
  });
});
