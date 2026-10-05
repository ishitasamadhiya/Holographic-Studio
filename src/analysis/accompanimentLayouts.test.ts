// End-to-end: accompaniment that is NOT neatly spread to the sides. The centre emphasis cannot
// remove centred or narrow accompaniment, so these songs test that the analysis still tells a
// voice from instruments (voiceLikeness.ts) and grades honestly when it cannot.
import { describe, expect, it } from 'vitest';
import { analyzeReference } from './analyzeReference';
import { scoreMelody } from './testing/metrics';
import type { RenderOptions } from './testing/renderSong';
import { makeSong, toMono } from './testing/signals';
import type { SongSpec } from './testing/songScore';

function specFor(seed: number): Partial<SongSpec> {
  return { seed, tonic: seed % 12, vocalRange: seed % 2 === 1 ? 'female' : 'male' };
}

const NARROW_LAYOUTS: { name: string; render: Partial<RenderOptions> }[] = [
  { name: 'accompaniment narrowed to half width', render: { accompanimentWidth: 0.5 } },
  { name: 'accompaniment narrowed to a fifth', render: { accompanimentWidth: 0.2 } },
  { name: 'pads in the centre', render: { stemWidths: { pads: 0 } } },
  { name: 'a centred synth lead line', render: { includeLead: true } },
];

describe('instrumental versions in any stereo layout', () => {
  const layouts: { name: string; render: Partial<RenderOptions> }[] = [
    { name: 'as arranged', render: {} },
    ...NARROW_LAYOUTS,
    { name: 'accompaniment nearly mono', render: { accompanimentWidth: 0.05 } },
    { name: 'arpeggio in the centre', render: { stemWidths: { arpeggio: 0 } } },
    { name: 'bass 6 dB louder', render: { stemLevelsDb: { bass: 6 } } },
  ];

  it.each(layouts)('$name: graded poor, next to nothing voiced', ({ render }) => {
    for (const seed of [21, 22]) {
      const song = makeSong(specFor(seed), { sampleRate: 32_000, ...render });
      const analysis = analyzeReference(song.instrumental);
      expect(analysis.quality, `seed ${seed}`).toBe('poor');
      expect(analysis.stats.voicedRatio, `seed ${seed}`).toBeLessThan(0.02);
    }
  });

  it('mono: graded poor, next to nothing voiced', () => {
    for (const seed of [23, 24]) {
      const song = makeSong(specFor(seed), { sampleRate: 32_000 });
      const analysis = analyzeReference(toMono(song.instrumental));
      expect(analysis.quality, `seed ${seed}`).toBe('poor');
      expect(analysis.stats.voicedRatio, `seed ${seed}`).toBeLessThan(0.02);
    }
  });
});

describe('a lead vocal over centred or narrow accompaniment', () => {
  // Inside sung phrases the tracker can slip onto a centred chord tone, which no contour test
  // can catch (pitch accuracy fell to 40 % in one such song). What must hold is the grade: a
  // melody that is used at all ('fair' or 'good') must be accurate and nearly free of false
  // alarms.
  it.each(NARROW_LAYOUTS)('$name: the melody is used only where it is accurate', (layout) => {
    for (const seed of [11, 12, 13, 14]) {
      const song = makeSong(specFor(seed), { sampleRate: 32_000, ...layout.render });
      const analysis = analyzeReference(song.mix);
      const melody = scoreMelody(song.truth, analysis.contour.f0Hz, analysis.contour.hopSec);
      if (analysis.quality === 'poor') continue;
      expect(melody.rawPitchAccuracy, `seed ${seed} pitch accuracy`).toBeGreaterThan(0.85);
      expect(melody.voicingFalseAlarm, `seed ${seed} false alarms`).toBeLessThan(0.1);
      if (analysis.quality === 'good') {
        expect(melody.rawPitchAccuracy, `seed ${seed} graded good`).toBeGreaterThan(0.9);
      }
    }
  });
});

describe('mono recordings', () => {
  const unaccompanied = { pads: null, arpeggio: null, bass: null, drums: null } as const;

  it.each([
    { seed: 11, vocalRange: 'female' },
    { seed: 12, vocalRange: 'male' },
  ] as const)('finds an unaccompanied $vocalRange voice and grades it good', (spec) => {
    const song = makeSong(spec, { sampleRate: 32_000, stemLevelsDb: unaccompanied });
    const analysis = analyzeReference(toMono(song.mix));
    const melody = scoreMelody(song.truth, analysis.contour.f0Hz, analysis.contour.hopSec);
    expect(analysis.quality).toBe('good');
    expect(melody.rawPitchAccuracy).toBeGreaterThan(0.95);
    expect(melody.voicingFalseAlarm).toBeLessThan(0.05);
  });

  it('uses the melody of a voice over one centred chord instrument', () => {
    const song = makeSong(
      { seed: 31, vocalRange: 'female' },
      { sampleRate: 32_000, stemLevelsDb: { arpeggio: null, bass: null, drums: null } },
    );
    const analysis = analyzeReference(toMono(song.mix));
    const melody = scoreMelody(song.truth, analysis.contour.f0Hz, analysis.contour.hopSec);
    expect(analysis.quality).not.toBe('poor');
    expect(melody.rawPitchAccuracy).toBeGreaterThan(0.9);
  });

  it('never grades a full band mixed to mono good', () => {
    // Pads, bass and arpeggio all compete with the voice in the centre; accuracy ranges from
    // 42 % to 92 % on these songs.
    for (const seed of [11, 12, 33, 34]) {
      const song = makeSong(specFor(seed), { sampleRate: 32_000 });
      const mono = toMono(song.mix);
      const analysis = analyzeReference(seed % 2 === 0 ? { ...mono, right: mono.left } : mono);
      expect(analysis.quality, `seed ${seed}`).not.toBe('good');
    }
  });
});
