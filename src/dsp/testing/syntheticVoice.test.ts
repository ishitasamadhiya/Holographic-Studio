import { midiToHz } from '@shared/music';
import { describe, expect, it } from 'vitest';
import {
  centsBetween,
  firstDelayedDifference,
  firstDifference,
  maxStep,
  mean,
  measurePitch,
  peak,
  rms,
  standardDeviation,
  trackPitchCents,
} from './measure';
import { createGaussian, createRandom } from './random';
import { harmonicTone, synthesizeVoice, whiteNoise } from './syntheticVoice';

const SAMPLE_RATE = 48000;

describe('synthesizeVoice', () => {
  it('sings exactly the requested pitch', () => {
    for (const midi of [43, 57.4, 69, 76.25]) {
      const voice = synthesizeVoice({ sampleRate: SAMPLE_RATE, durationSec: 0.6, midi });
      const measured = measurePitch(voice, SAMPLE_RATE, 4800, 14400, midiToHz(midi), 100);
      expect(Math.abs(centsBetween(measured.hz, midiToHz(midi)))).toBeLessThan(0.2);
      expect(measured.periodicity).toBeGreaterThan(0.9999);
    }
  });

  it('has the requested level and vibrato', () => {
    const voice = synthesizeVoice({
      sampleRate: SAMPLE_RATE,
      durationSec: 1.5,
      midi: 60,
      level: 0.2,
      vibratoHz: 5,
      vibratoCents: 40,
    });
    expect(rms(voice, 4800)).toBeCloseTo(0.2, 2);
    const track = trackPitchCents(voice, {
      sampleRate: SAMPLE_RATE,
      startSec: 0.2,
      endSec: 1.2,
      referenceHz: midiToHz(60),
      windowSec: 3 / midiToHz(60),
    });
    // A sine of amplitude 40 has a standard deviation of 40 / √2.
    expect(standardDeviation(track)).toBeCloseTo(40 / Math.SQRT2, 0);
    expect(Math.abs(mean(track))).toBeLessThan(2);
  });

  it('has a vowel-like spectrum: the harmonic nearest the first formant is the strongest', () => {
    // At 146 Hz the fifth harmonic sits on the 730 Hz formant.
    const f0Hz = 146;
    const voice = synthesizeVoice({
      sampleRate: SAMPLE_RATE,
      durationSec: 0.5,
      midi: 69 + 12 * Math.log2(f0Hz / 440),
    });
    const amplitudeOf = (harmonic: number): number => {
      let real = 0;
      let imaginary = 0;
      for (let n = 4800; n < 4800 + 9600; n++) {
        const phase = (2 * Math.PI * harmonic * f0Hz * n) / SAMPLE_RATE;
        real += voice[n]! * Math.cos(phase);
        imaginary += voice[n]! * Math.sin(phase);
      }
      return Math.hypot(real, imaginary);
    };
    const amplitudes = [1, 2, 3, 4, 5, 6, 7, 8].map(amplitudeOf);
    expect(amplitudes.indexOf(Math.max(...amplitudes))).toBe(4);
    // …but the fundamental keeps a realistic share (within 20 dB of the strongest).
    expect(amplitudes[0]! / amplitudes[4]!).toBeGreaterThan(0.1);
  });

  it('can weaken the fundamental, add jitter and add breath', () => {
    const base = { sampleRate: SAMPLE_RATE, durationSec: 0.5, midi: 57 } as const;
    const clean = synthesizeVoice(base);
    const periodicityOf = (signal: Float32Array) =>
      measurePitch(signal, SAMPLE_RATE, 4800, 9600, midiToHz(57), 100).periodicity;
    expect(periodicityOf(synthesizeVoice({ ...base, breathLevel: 0.3 }))).toBeLessThan(
      periodicityOf(clean) - 0.01,
    );
    expect(periodicityOf(synthesizeVoice({ ...base, jitterCents: 20 }))).toBeLessThan(
      periodicityOf(clean) - 0.001,
    );
    const weak = synthesizeVoice({ ...base, fundamentalGain: 0.1 });
    expect(firstDifference(weak, clean)).toBeGreaterThanOrEqual(0);
    expect(
      measurePitch(weak, SAMPLE_RATE, 4800, 9600, midiToHz(57), 100).periodicity,
    ).toBeGreaterThan(0.999);
  });

  it('is silent during rests and fades in and out of notes without clicks', () => {
    const voice = synthesizeVoice({
      sampleRate: SAMPLE_RATE,
      durationSec: 1,
      midi: (timeSec) => (timeSec >= 0.3 && timeSec < 0.6 ? 60 : Number.NaN),
    });
    expect(peak(voice, 0, 0.3 * SAMPLE_RATE)).toBe(0);
    expect(peak(voice, 0.62 * SAMPLE_RATE)).toBe(0);
    expect(rms(voice, 0.35 * SAMPLE_RATE, 0.55 * SAMPLE_RATE)).toBeCloseTo(0.1, 2);
    const steady = maxStep(voice, 0.35 * SAMPLE_RATE, 0.55 * SAMPLE_RATE);
    expect(maxStep(voice, 0.29 * SAMPLE_RATE, 0.32 * SAMPLE_RATE)).toBeLessThanOrEqual(steady);
    expect(maxStep(voice, 0.59 * SAMPLE_RATE, 0.62 * SAMPLE_RATE)).toBeLessThanOrEqual(steady);
  });

  it('is reproducible for a seed and different between seeds', () => {
    const options = {
      sampleRate: SAMPLE_RATE,
      durationSec: 0.2,
      midi: 60,
      jitterCents: 10,
      breathLevel: 0.1,
    } as const;
    const first = synthesizeVoice({ ...options, seed: 7 });
    expect(firstDifference(synthesizeVoice({ ...options, seed: 7 }), first)).toBe(-1);
    expect(firstDifference(synthesizeVoice({ ...options, seed: 8 }), first)).toBeGreaterThanOrEqual(
      0,
    );
  });
});

describe('harmonicTone and whiteNoise', () => {
  it('builds a tone with the requested pitch, peak and harmonics', () => {
    const tone = harmonicTone({
      sampleRate: SAMPLE_RATE,
      durationSec: 0.3,
      f0Hz: 330,
      harmonics: [0, 1, 0.5],
      peak: 0.4,
    });
    expect(peak(tone)).toBeCloseTo(0.4, 6);
    const measured = measurePitch(tone, SAMPLE_RATE, 1000, 9600, 330, 100);
    expect(Math.abs(centsBetween(measured.hz, 330))).toBeLessThan(0.1);
  });

  it('builds noise with the requested level and no pitch', () => {
    const noise = whiteNoise(SAMPLE_RATE, 1, 0.25, 3);
    expect(rms(noise)).toBeCloseTo(0.25, 2);
    expect(Math.abs(mean(Array.from(noise)))).toBeLessThan(0.01);
    expect(measurePitch(noise, SAMPLE_RATE, 1000, 9600, 220, 300).periodicity).toBeLessThan(0.2);
  });
});

describe('random', () => {
  it('produces uniform numbers in [0, 1) and standard normal numbers', () => {
    const random = createRandom(42);
    const uniform = Array.from({ length: 20000 }, random);
    expect(Math.min(...uniform)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...uniform)).toBeLessThan(1);
    expect(mean(uniform)).toBeCloseTo(0.5, 1);
    const gaussian = createGaussian(createRandom(43));
    const normal = Array.from({ length: 20000 }, gaussian);
    expect(mean(normal)).toBeCloseTo(0, 1);
    expect(standardDeviation(normal)).toBeCloseTo(1, 1);
  });
});

describe('measurement helpers', () => {
  it('compare buffers sample by sample', () => {
    const a = Float32Array.of(1, 2, 3, 4);
    expect(firstDifference(a, Float32Array.of(1, 2, 3, 4))).toBe(-1);
    expect(firstDifference(a, Float32Array.of(1, 2, 9, 4))).toBe(2);
    expect(firstDifference(a, Float32Array.of(1, 2, 3))).toBe(3);
    expect(firstDelayedDifference(Float32Array.of(0, 0, 1, 2, 3), a, 2)).toBe(-1);
    expect(firstDelayedDifference(Float32Array.of(0, 0, 1, 7, 3), a, 2)).toBe(3);
    expect(firstDelayedDifference(Float32Array.of(0, 0, 1, 7, 3), a, 2, 4)).toBe(-1);
  });

  it('measure level, peaks and steps over a range given in fractional samples', () => {
    const ramp = Float32Array.of(0, 0.1, 0.3, 0.2, -0.5, 0);
    expect(peak(ramp)).toBeCloseTo(0.5, 6);
    expect(peak(ramp, 0, 3.2)).toBeCloseTo(0.3, 6);
    expect(maxStep(ramp)).toBeCloseTo(0.7, 6);
    expect(maxStep(ramp, 0, 3.9999)).toBeCloseTo(0.2, 6);
    expect(rms(Float32Array.of(3, -3, 3, -3), 0.2, 99)).toBeCloseTo(3, 6);
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 9);
  });
});
