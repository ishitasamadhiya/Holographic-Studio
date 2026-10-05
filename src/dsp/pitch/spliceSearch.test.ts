import { describe, expect, it } from 'vitest';
import { harmonicTone, whiteNoise } from '../testing/syntheticVoice';
import { SpliceSearch } from './spliceSearch';

const SAMPLE_RATE = 48000;

describe('SpliceSearch', () => {
  const truePeriod = 218.6;
  const tone = harmonicTone({
    sampleRate: SAMPLE_RATE,
    durationSec: 0.1,
    f0Hz: SAMPLE_RATE / truePeriod,
    harmonics: [1, 0.7, 0.5, 0.4, 0.3, 0.2, 0.1],
  });
  const search = new SpliceSearch(800);

  it('searches a few percent on each side of the period', () => {
    expect(SpliceSearch.radiusFor(40)).toBe(2);
    expect(SpliceSearch.radiusFor(218)).toBe(9);
    expect(SpliceSearch.radiusFor(800)).toBe(32);
  });

  /** Searches around a nominal period the way the pitch shifter does. */
  function findNear(
    data: Float32Array,
    windowLength: number,
    stride: number,
    direction: 1 | -1,
    nominal: number,
  ): number | null {
    const found = search.find(
      data,
      2000,
      windowLength,
      stride,
      direction,
      Math.round(nominal),
      SpliceSearch.radiusFor(nominal),
    );
    return found ? search.lag : null;
  }

  it('corrects a period estimate that is up to 3% off, to a fraction of a sample', () => {
    for (const error of [0.97, 0.985, 1, 1.015, 1.03]) {
      for (const direction of [1, -1] as const) {
        const found = findNear(tone, 218, 1, direction, truePeriod * error);
        expect(found, `${error}, ${direction}`).not.toBeNull();
        expect(Math.abs(found! - truePeriod), `${error}, ${direction}`).toBeLessThan(0.05);
      }
    }
  });

  it('gives the same answer when the comparison is subsampled', () => {
    const found = findNear(tone, 436, 2, 1, truePeriod * 1.02);
    expect(Math.abs(found! - truePeriod)).toBeLessThan(0.05);
  });

  it('reports no match when the signal is not periodic', () => {
    const noise = whiteNoise(SAMPLE_RATE, 0.1, 0.2, 11);
    expect(findNear(noise, 218, 1, 1, 222.5)).toBeNull();
    expect(findNear(new Float32Array(4800), 218, 1, -1, 222.5)).toBeNull();
  });

  it('never searches further than its buffers allow', () => {
    const small = new SpliceSearch(100);
    // Asked for a radius far beyond what it was built for: it searches what it can.
    expect(small.find(tone, 2000, 218, 1, 1, 100, 500)).toBe(false);
    expect(small.find(tone, 2000, 218, 1, 1, 219, 500)).toBe(true);
    expect(Math.abs(small.lag - truePeriod)).toBeLessThan(0.05);
  });
});
