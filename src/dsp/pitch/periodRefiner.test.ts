import { describe, expect, it } from 'vitest';
import { harmonicTone, whiteNoise } from '../testing/syntheticVoice';
import { PeriodRefiner } from './periodRefiner';

const SAMPLE_RATE = 48000;
const MAX_PERIOD = SAMPLE_RATE / 68;

/** Refines around `coarsePeriod`, rounded to whole samples as the detector does. */
function refine(signal: Float32Array, coarsePeriod: number): PeriodRefiner {
  const refiner = new PeriodRefiner(SAMPLE_RATE, MAX_PERIOD);
  refiner.refine(signal, signal.length - 1, Math.round(coarsePeriod));
  return refiner;
}

describe('PeriodRefiner', () => {
  const harmonics = [1, 0.6, 0.4, 0.3, 0.2, 0.1];

  it('measures the period to a small fraction of a sample across the vocal range', () => {
    for (const f0Hz of [72, 110, 196.5, 220, 311.1, 523.25, 880, 990]) {
      const tone = harmonicTone({ sampleRate: SAMPLE_RATE, durationSec: 0.1, f0Hz, harmonics });
      const truePeriod = SAMPLE_RATE / f0Hz;
      const refiner = refine(tone, truePeriod);
      expect(Math.abs(refiner.period - truePeriod)).toBeLessThan(0.02);
      expect(refiner.clarity).toBeGreaterThan(0.999);
    }
  });

  it('recovers the true period from a coarse estimate that is 4% off in either direction', () => {
    for (const f0Hz of [82.4, 220, 440, 700]) {
      const tone = harmonicTone({ sampleRate: SAMPLE_RATE, durationSec: 0.1, f0Hz, harmonics });
      const truePeriod = SAMPLE_RATE / f0Hz;
      for (const error of [0.96, 1.04]) {
        expect(Math.abs(refine(tone, truePeriod * error).period - truePeriod)).toBeLessThan(0.03);
      }
    }
  });

  it('stays inside its search range when the coarse estimate is far off', () => {
    const tone = harmonicTone({ sampleRate: SAMPLE_RATE, durationSec: 0.1, f0Hz: 200, harmonics });
    const coarse = Math.round((SAMPLE_RATE / 200) * 1.2);
    const refiner = refine(tone, coarse);
    expect(Math.abs(refiner.period - coarse)).toBeLessThanOrEqual(Math.ceil(0.05 * coarse));
  });

  it('reports low clarity for noise and none for silence', () => {
    const noise = whiteNoise(SAMPLE_RATE, 0.1, 0.1, 7);
    expect(refine(noise, 218).clarity).toBeLessThan(0.4);
    expect(refine(new Float32Array(4800), 218).clarity).toBe(0);
  });

  it('declares how much history it reads', () => {
    const refiner = new PeriodRefiner(SAMPLE_RATE, MAX_PERIOD);
    // Longest window (one period) plus the longest lag (period + 5%), with a little slack.
    expect(refiner.requiredHistory).toBeGreaterThanOrEqual(Math.ceil(2.05 * MAX_PERIOD));
    expect(refiner.requiredHistory).toBeLessThan(2.3 * MAX_PERIOD);
    const tone = harmonicTone({
      sampleRate: SAMPLE_RATE,
      durationSec: 0.1,
      f0Hz: 70,
      harmonics,
    });
    const padded = new Float32Array(refiner.requiredHistory + 1);
    padded.set(tone.subarray(0, padded.length));
    refiner.refine(padded, padded.length - 1, Math.round(SAMPLE_RATE / 70));
    expect(Math.abs(refiner.period - SAMPLE_RATE / 70)).toBeLessThan(0.05);
  });
});
