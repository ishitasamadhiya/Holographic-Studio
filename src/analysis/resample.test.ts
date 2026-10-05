import { describe, expect, it } from 'vitest';
import { resample } from './resample';

function sine(frequencyHz: number, sampleRate: number, durationSec: number): Float32Array {
  const length = Math.round(durationSec * sampleRate);
  return Float32Array.from({ length }, (_, n) =>
    Math.sin((2 * Math.PI * frequencyHz * n) / sampleRate),
  );
}

/** RMS of the middle of a signal (the ends carry the filter's edge transient). */
function rmsOfMiddle(signal: Float32Array): number {
  const from = Math.floor(signal.length * 0.25);
  const to = Math.floor(signal.length * 0.75);
  let sum = 0;
  for (let index = from; index < to; index++) sum += signal[index]! ** 2;
  return Math.sqrt(sum / (to - from));
}

/** Largest deviation from an ideal sine of the same frequency and phase, in the middle. */
function worstErrorAgainstSine(
  signal: Float32Array,
  frequencyHz: number,
  sampleRate: number,
): number {
  let worst = 0;
  for (let n = Math.floor(signal.length * 0.25); n < signal.length * 0.75; n++) {
    const ideal = Math.sin((2 * Math.PI * frequencyHz * n) / sampleRate);
    worst = Math.max(worst, Math.abs(signal[n]! - ideal));
  }
  return worst;
}

const UNIT_SINE_RMS = Math.SQRT1_2;

describe('resample', () => {
  it('keeps a pass-band tone intact and in phase when decimating 48 kHz to 16 kHz', () => {
    const output = resample(sine(1000, 48_000, 0.5), 48_000, 16_000);
    expect(output.length).toBe(8000);
    expect(worstErrorAgainstSine(output, 1000, 16_000)).toBeLessThan(1e-3);
  });

  it('handles the non-integer ratio 44.1 kHz to 16 kHz', () => {
    const output = resample(sine(3000, 44_100, 0.5), 44_100, 16_000);
    expect(output.length).toBe(Math.floor((22_050 * 16_000) / 44_100));
    expect(worstErrorAgainstSine(output, 3000, 16_000)).toBeLessThan(2e-3);
  });

  it('is flat up to 0.4 of the output rate', () => {
    const output = resample(sine(6400, 48_000, 0.5), 48_000, 16_000);
    expect(rmsOfMiddle(output) / UNIT_SINE_RMS).toBeGreaterThan(0.99);
  });

  it.each([10_000, 12_000, 15_000, 20_000])(
    'removes a %i Hz tone that would alias into the analysis band',
    (frequencyHz) => {
      const output = resample(sine(frequencyHz, 48_000, 0.5), 48_000, 16_000);
      const attenuationDb = 20 * Math.log10(rmsOfMiddle(output) / UNIT_SINE_RMS);
      expect(attenuationDb).toBeLessThan(-55);
    },
  );

  it('upsamples without changing the tone', () => {
    const output = resample(sine(1000, 8000, 0.5), 8000, 16_000);
    expect(output.length).toBe(8000);
    expect(worstErrorAgainstSine(output, 1000, 16_000)).toBeLessThan(2e-3);
  });

  it('copes with rates that share no convenient ratio', () => {
    const output = resample(sine(2000, 44_056, 0.5), 44_056, 16_000);
    expect(worstErrorAgainstSine(output, 2000, 16_000)).toBeLessThan(5e-3);
  });

  it('returns an independent copy when the rates are equal', () => {
    const input = sine(440, 16_000, 0.1);
    const output = resample(input, 16_000, 16_000);
    expect(output).not.toBe(input);
    expect(Array.from(output)).toEqual(Array.from(input));
  });

  it('returns nothing for empty input and rejects invalid rates', () => {
    expect(resample(new Float32Array(0), 48_000, 16_000).length).toBe(0);
    expect(() => resample(new Float32Array(10), 0, 16_000)).toThrow(RangeError);
    expect(() => resample(new Float32Array(10), 48_000, Number.NaN)).toThrow(RangeError);
  });
});
