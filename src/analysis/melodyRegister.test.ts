// Melodies that change register between phrases (call and response, a duet, a chorus lifted an
// octave). The tracker's octave repair must follow each phrase's own register.
import { describe, expect, it } from 'vitest';
import { analyzeReference } from './analyzeReference';
import { scoreMelody } from './testing/metrics';
import { makeSong } from './testing/signals';
import type { SongSpec } from './testing/songScore';

const PHRASINGS: (Partial<SongSpec> & { seed: number })[] = [
  { seed: 6262, phraseRegister: 'alternating' },
  { seed: 6301, phraseRegister: 'alternating' },
  { seed: 6303, phraseRegister: 'alternating' },
  { seed: 6305, phraseRegister: 'section', durationSec: 36 },
];
const CASES: Partial<SongSpec>[] = PHRASINGS.flatMap((spec) =>
  (['female', 'male'] as const).map((vocalRange) => ({
    ...spec,
    vocalRange,
    tonic: spec.seed % 12,
  })),
);

describe('melody that moves between registers', () => {
  it.each(CASES)(
    '$phraseRegister register, $vocalRange voice (seed $seed): each phrase in its octave',
    (spec) => {
      const song = makeSong(spec, { sampleRate: 32_000 });
      const analysis = analyzeReference(song.mix);
      const melody = scoreMelody(song.truth, analysis.contour.f0Hz, analysis.contour.hopSec);
      expect(melody.rawPitchAccuracy).toBeGreaterThan(0.93);
      expect(melody.rawChromaAccuracy - melody.rawPitchAccuracy).toBeLessThan(0.05);
      expect(analysis.quality).toBe('good');
    },
  );
});
