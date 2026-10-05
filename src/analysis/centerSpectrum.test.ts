import { describe, expect, it } from 'vitest';
import { CenterSpectrumAnalyzer } from './centerSpectrum';
import {
  ANALYSIS_SAMPLE_RATE,
  PITCH_BINS_PER_SEMITONE,
  PITCH_MIN_MIDI,
  pitchBinToHz,
} from './frames';
import { HarmonicDominance } from './harmonicDominance';
import { HarmonicSalience, createSaliencePeaks, pickSaliencePeaks } from './salience';
import { SeededRandom } from './testing/random';
import { hzToMidi } from '@shared/music';

function midiToPitchBin(midi: number): number {
  return (midi - PITCH_MIN_MIDI) * PITCH_BINS_PER_SEMITONE;
}

const LENGTH = ANALYSIS_SAMPLE_RATE;
/** A frame in the middle of the one-second test signals. */
const MIDDLE_FRAME = 50;

/** Harmonic tone with 1/h amplitudes; `fundamentalGain` scales the first partial only. */
function harmonicTone(frequencyHz: number, harmonics: number, fundamentalGain = 1): Float32Array {
  return Float32Array.from({ length: LENGTH }, (_, n) => {
    let sample = 0;
    for (let h = 1; h <= harmonics; h++) {
      const gain = h === 1 ? fundamentalGain : 1 / h;
      sample += gain * Math.sin((2 * Math.PI * h * frequencyHz * n) / ANALYSIS_SAMPLE_RATE);
    }
    return 0.2 * sample;
  });
}

function noise(seed: number, level = 0.2): Float32Array {
  const random = new SeededRandom(seed);
  return Float32Array.from({ length: LENGTH }, () => level * random.noise());
}

function scaled(signal: Float32Array, gain: number): Float32Array {
  return signal.map((sample) => sample * gain);
}

function sum(a: Float32Array, b: Float32Array): Float32Array {
  return a.map((sample, index) => sample + b[index]!);
}

function analyze(left: Float32Array, right: Float32Array | null): CenterSpectrumAnalyzer {
  const analyzer = new CenterSpectrumAnalyzer(left, right);
  analyzer.analyzeFrame(MIDDLE_FRAME);
  return analyzer;
}

describe('CenterSpectrumAnalyzer', () => {
  const tone = harmonicTone(440, 8);

  it('keeps a centred source completely', () => {
    const analyzer = analyze(tone, tone);
    expect(analyzer.centerBandPower / analyzer.mixBandPower).toBeCloseTo(1, 3);
    expect(analyzer.sideBandPower / analyzer.mixBandPower).toBeLessThan(1e-6);
  });

  it('treats mono material as all centre', () => {
    const analyzer = analyze(tone, null);
    expect(analyzer.centerBandPower).toBeCloseTo(analyzer.mixBandPower, 9);
    expect(analyzer.sideBandPower).toBe(0);
    expect(Array.from(analyzer.centerPower).every((value) => value >= 0)).toBe(true);
  });

  it('removes a hard-panned source', () => {
    const analyzer = analyze(tone, new Float32Array(LENGTH));
    expect(Math.abs(analyzer.centerBandPower) / analyzer.mixBandPower).toBeLessThan(1e-6);
    expect(analyzer.sideBandPower / analyzer.mixBandPower).toBeCloseTo(0.5, 3);
  });

  it('pushes a source panned 60 % to one side more than 10 dB down', () => {
    const angle = (1.6 * Math.PI) / 4;
    const analyzer = analyze(scaled(tone, Math.cos(angle)), scaled(tone, Math.sin(angle)));
    const keptDb = 10 * Math.log10(analyzer.centerBandPower / analyzer.mixBandPower);
    expect(keptDb).toBeLessThan(-10);
    expect(keptDb).toBeGreaterThan(-20);
  });

  it('counts out-of-phase content as negative, so that it cancels instead of leaking', () => {
    const analyzer = analyze(tone, scaled(tone, -1));
    expect(analyzer.centerBandPower).toBeLessThan(0);
    expect(analyzer.sideBandPower / analyzer.mixBandPower).toBeCloseTo(1, 3);
  });

  it('nearly cancels decorrelated (wide) noise over the band', () => {
    const analyzer = analyze(noise(1), noise(2));
    expect(Math.abs(analyzer.centerBandPower) / analyzer.mixBandPower).toBeLessThan(0.1);
  });

  it('ignores energy below the vocal band', () => {
    const bass = harmonicTone(50, 1);
    const analyzer = analyze(bass, bass);
    const total = analyzer.mixPower.reduce((accumulated, value) => accumulated + value, 0);
    expect(analyzer.mixBandPower / total).toBeLessThan(0.01);
  });
});

describe('HarmonicSalience', () => {
  const salience = new HarmonicSalience();
  const peaks = createSaliencePeaks(5);

  function strongestPitchHz(signal: Float32Array): number {
    salience.compute(analyze(signal, null).centerPower);
    pickSaliencePeaks(salience.salience, peaks);
    return pitchBinToHz(peaks[0]!.pitchBin);
  }

  it.each([110, 196, 261.63, 440, 880])(
    'peaks at the fundamental of a %f Hz tone',
    (frequencyHz) => {
      const errorCents =
        1200 * Math.log2(strongestPitchHz(harmonicTone(frequencyHz, 10)) / frequencyHz);
      expect(Math.abs(errorCents)).toBeLessThan(5);
    },
  );

  it('finds the pitch of a low tone whose fundamental is 12 dB weaker than its second partial', () => {
    const errorCents = 1200 * Math.log2(strongestPitchHz(harmonicTone(150, 12, 0.125)) / 150);
    expect(Math.abs(errorCents)).toBeLessThan(5);
  });

  it('reads a tone with no fundamental at all an octave high (left to the tracker to resolve)', () => {
    const errorCents = 1200 * Math.log2(strongestPitchHz(harmonicTone(150, 12, 0)) / 150);
    expect(Math.abs(errorCents - 1200)).toBeLessThan(5);
  });

  it('ranks the octave below clearly lower than the true pitch', () => {
    salience.compute(analyze(harmonicTone(330, 10), null).centerPower);
    const at = (frequencyHz: number) =>
      salience.salience[Math.round(midiToPitchBin(hzToMidi(frequencyHz)))]!;
    expect(at(165) / at(330)).toBeLessThan(0.7);
    expect(at(660) / at(330)).toBeLessThan(0.9);
  });
});

describe('pickSaliencePeaks', () => {
  it('returns the strongest local maxima in order, refined between bins', () => {
    const values = new Float32Array(40);
    values.set([1, 3, 1], 4);
    values.set([2, 9, 8], 14);
    values.set([1, 5, 1], 24);
    values.set([1, 2, 1], 34);
    const peaks = createSaliencePeaks(3);
    expect(pickSaliencePeaks(values, peaks)).toBe(3);
    expect(peaks.map((peak) => Math.round(peak.pitchBin))).toEqual([15, 25, 5]);
    // The peak at bin 15 leans toward its higher neighbour.
    expect(peaks[0]!.pitchBin).toBeGreaterThan(15.2);
    expect(peaks[0]!.pitchBin).toBeLessThan(15.5);
    expect(peaks[0]!.salience).toBeGreaterThan(9);
    expect(peaks[1]!.pitchBin).toBeCloseTo(25, 9);
  });

  it('marks unused slots with zero salience', () => {
    const values = new Float32Array(20);
    values.set([1, 4, 1], 8);
    const peaks = createSaliencePeaks(4);
    expect(pickSaliencePeaks(values, peaks)).toBe(1);
    expect(peaks.map((peak) => peak.salience)).toEqual([4, 0, 0, 0]);
  });
});

describe('HarmonicDominance', () => {
  const dominance = new HarmonicDominance();

  function dominanceOf(
    left: Float32Array,
    right: Float32Array | null,
    frequencyHz: number,
  ): number {
    const analyzer = analyze(left, right);
    const pitchBin = midiToPitchBin(hzToMidi(frequencyHz));
    dominance.setFrame(analyzer.centerPower);
    return dominance.dominance(
      pitchBin,
      dominance.harmonicPower(pitchBin),
      analyzer.centerBandPower,
      analyzer.mixBandPower,
    );
  }

  it('is close to 1 for a lone harmonic source at its own pitch', () => {
    const tone = harmonicTone(300, 12);
    expect(dominanceOf(tone, tone, 300)).toBeGreaterThan(0.95);
  });

  it('is close to 0 for noise, also at low pitches whose harmonics cover half the band', () => {
    const hiss = noise(3);
    expect(dominanceOf(hiss, hiss, 90)).toBeLessThan(0.1);
    expect(dominanceOf(hiss, hiss, 300)).toBeLessThan(0.1);
  });

  it('is close to 0 at a pitch that is not being played', () => {
    const tone = harmonicTone(300, 12);
    expect(dominanceOf(tone, tone, 410)).toBeLessThan(0.05);
  });

  it('reports the share of a centred source against wide accompaniment', () => {
    const tone = harmonicTone(300, 12);
    const withWideNoise = dominanceOf(sum(tone, noise(4, 0.05)), sum(tone, noise(5, 0.05)), 300);
    const withLoudWideNoise = dominanceOf(
      sum(tone, noise(4, 0.15)),
      sum(tone, noise(5, 0.15)),
      300,
    );
    expect(withWideNoise).toBeGreaterThan(withLoudWideNoise);
    expect(withWideNoise).toBeLessThan(1);
    expect(withLoudWideNoise).toBeGreaterThan(0.1);
  });

  it('drops when the same source is panned to the side', () => {
    const tone = harmonicTone(300, 12);
    expect(dominanceOf(tone, new Float32Array(LENGTH), 300)).toBeLessThan(0.01);
  });

  it('returns 0 for a silent frame', () => {
    const silent = new Float32Array(LENGTH);
    expect(dominanceOf(silent, silent, 300)).toBe(0);
  });
});
