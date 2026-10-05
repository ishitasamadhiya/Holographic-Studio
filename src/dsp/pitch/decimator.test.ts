import { describe, expect, it } from 'vitest';
import { designLowpassFir } from './decimator';

/** Magnitude response of an FIR at a frequency given as a fraction of the sample rate. */
function magnitudeAt(taps: Float32Array, frequency: number): number {
  let real = 0;
  let imaginary = 0;
  for (let n = 0; n < taps.length; n++) {
    real += taps[n]! * Math.cos(2 * Math.PI * frequency * n);
    imaginary -= taps[n]! * Math.sin(2 * Math.PI * frequency * n);
  }
  return Math.hypot(real, imaginary);
}

describe('designLowpassFir', () => {
  // The pitch detector's anti-alias filter at 48 kHz: decimation by 6.
  const decimation = 6;
  const cutoff = 0.25 / decimation;
  const taps = designLowpassFir(8 * decimation + 1, cutoff);

  it('has unity gain at DC and linear phase', () => {
    let sum = 0;
    for (const tap of taps) sum += tap;
    expect(sum).toBeCloseTo(1, 6);
    for (let n = 0; n < taps.length; n++) {
      expect(taps[n]).toBeCloseTo(taps[taps.length - 1 - n]!, 7);
    }
  });

  it('keeps the fundamental of every detectable pitch and is 6 dB down at the cutoff', () => {
    expect(magnitudeAt(taps, 300 / 48000)).toBeGreaterThan(0.98);
    expect(magnitudeAt(taps, 1000 / 48000)).toBeGreaterThan(0.85);
    expect(magnitudeAt(taps, cutoff)).toBeCloseTo(0.5, 1);
  });

  it('falls monotonically through the transition band', () => {
    let previous = magnitudeAt(taps, 0);
    for (let frequencyHz = 100; frequencyHz <= 3600; frequencyHz += 100) {
      const magnitude = magnitudeAt(taps, frequencyHz / 48000);
      expect(magnitude).toBeLessThan(previous);
      previous = magnitude;
    }
  });

  it('suppresses everything that would alias after decimation by at least 46 dB', () => {
    // Decimating to 8 kHz folds everything above 4 kHz back into the analysis band.
    for (let frequencyHz = 4000; frequencyHz <= 24000; frequencyHz += 50) {
      expect(magnitudeAt(taps, frequencyHz / 48000)).toBeLessThan(0.005);
    }
  });
});
