import { describe, expect, it } from 'vitest';
import { gainToDb } from './decibels';
import { silentStem, stereoSine } from './testSupport';
import { TruePeakMeter } from './truePeakMeter';

function truePeakOf(samples: Float32Array, blockFrames = 1000): number {
  const meter = new TruePeakMeter();
  const frames = samples.length / 2;
  for (let start = 0; start < frames; start += blockFrames) {
    const count = Math.min(blockFrames, frames - start);
    meter.process(samples.subarray(start * 2, (start + count) * 2), count);
  }
  return meter.truePeak();
}

/** A sine at a quarter of the sample rate, sampled 45 degrees away from its crests. */
function quarterRateSine(frames: number, amplitude: number): Float32Array {
  const samples = new Float32Array(frames * 2);
  for (let frame = 0; frame < frames; frame++) {
    const value = amplitude * Math.sin((Math.PI / 2) * frame + Math.PI / 4);
    samples[frame * 2] = value;
    samples[frame * 2 + 1] = value;
  }
  return samples;
}

describe('TruePeakMeter', () => {
  it('finds the crest between samples that a sample-peak meter misses by 3 dB', () => {
    const samples = quarterRateSine(4800, 0.5);
    let samplePeak = 0;
    for (const sample of samples) samplePeak = Math.max(samplePeak, Math.abs(sample));
    expect(gainToDb(samplePeak / 0.5)).toBeCloseTo(-3.01, 1);

    const truePeakDb = gainToDb(truePeakOf(samples) / 0.5);
    expect(Math.abs(truePeakDb)).toBeLessThan(0.2);
  });

  it('matches the sample peak for a low-frequency sine', () => {
    const samples = stereoSine(48000, 100, 0.7);
    expect(truePeakOf(samples)).toBeCloseTo(0.7, 3);
  });

  it('looks at both channels', () => {
    const samples = silentStem(1000);
    samples[501] = -0.9;
    // A lone impulse is its own peak: the interpolated points around it are all lower.
    expect(truePeakOf(samples)).toBeCloseTo(0.9, 6);
  });

  it('gives the same answer however the audio is split into blocks', () => {
    const samples = quarterRateSine(5000, 0.8);
    expect(truePeakOf(samples, 7)).toBe(truePeakOf(samples, 5000));
  });

  it('is zero for silence', () => {
    expect(truePeakOf(silentStem(2000))).toBe(0);
  });
});
