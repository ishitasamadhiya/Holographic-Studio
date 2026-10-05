import { describe, expect, it } from 'vitest';
import { dbToGain } from './decibels';
import { biquadMagnitude, kWeightingCoefficients } from './kWeighting';
import { LoudnessMeter } from './loudnessMeter';
import { silentStem, stereoSine } from './testSupport';

function measure(samples: Float32Array, sampleRate = 48000, blockFrames = 4096): number {
  const meter = new LoudnessMeter(sampleRate);
  const frames = samples.length / 2;
  for (let start = 0; start < frames; start += blockFrames) {
    const count = Math.min(blockFrames, frames - start);
    meter.process(samples.subarray(start * 2, (start + count) * 2), count);
  }
  return meter.integratedLufs();
}

function concat(...parts: Float32Array[]): Float32Array {
  const joined = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

/*
 * Reference levels. ITU-R BS.1770-4 defines the scale by one fact: a 0 dBFS (peak) 997 Hz
 * sine in a single channel reads -3.01 LKFS. The same sine in both channels of a stereo
 * file has twice the energy, so it reads 0.0 LUFS, and a stereo 1 kHz sine with a peak of
 * -N dBFS reads -N LUFS. EBU Tech 3341 uses exactly this as its first conformance signal
 * (stereo 1 kHz sine at -23.0 dBFS must read -23.0 LUFS +/- 0.1).
 */
describe('LoudnessMeter', () => {
  it('reads -20.0 LUFS for a stereo 1 kHz sine peaking at -20 dBFS', () => {
    const sine = stereoSine(48000 * 5, 1000, dbToGain(-20));
    expect(measure(sine)).toBeCloseTo(-20, 1);
  });

  it('reads -23.0 LUFS for the EBU Tech 3341 case 1 signal', () => {
    const sine = stereoSine(48000 * 20, 1000, dbToGain(-23));
    expect(Math.abs(measure(sine) - -23)).toBeLessThan(0.1);
  });

  it('reads -3.01 LKFS for a full-scale 997 Hz sine in the left channel only', () => {
    const sine = stereoSine(48000 * 5, 997, 1);
    for (let frame = 0; frame < sine.length / 2; frame++) sine[frame * 2 + 1] = 0;
    expect(measure(sine)).toBeCloseTo(-3.01, 1);
  });

  it('gives the same reading at 44.1 kHz', () => {
    const sine = stereoSine(44100 * 5, 1000, dbToGain(-20), 44100);
    expect(measure(sine, 44100)).toBeCloseTo(-20, 1);
  });

  it('does not depend on how the audio is split into blocks', () => {
    const sine = stereoSine(48000 * 3, 440, 0.3);
    expect(measure(sine, 48000, 100)).toBeCloseTo(measure(sine, 48000, 48000 * 3), 9);
  });

  it.each([100, 5000, 12_000])(
    'applies the K-weighting curve: a %d Hz sine reads its level plus the filter gain',
    (frequencyHz) => {
      const { shelf, highPass } = kWeightingCoefficients(48000);
      const filterGainDb =
        20 *
        Math.log10(
          biquadMagnitude(shelf, frequencyHz, 48000) *
            biquadMagnitude(highPass, frequencyHz, 48000),
        );
      const sine = stereoSine(48000 * 5, frequencyHz, dbToGain(-20));
      expect(measure(sine)).toBeCloseTo(-20 - 0.691 + filterGainDb, 1);
    },
  );

  it('ignores silence around the programme (absolute gate)', () => {
    const tone = stereoSine(48000 * 10, 1000, dbToGain(-20));
    const padded = concat(silentStem(48000 * 10), tone, silentStem(48000 * 10));
    // Without gating, 20 s of silence around 10 s of tone would read about 4.8 dB lower.
    expect(Math.abs(measure(padded) - -20)).toBeLessThan(0.15);
  });

  it('ignores passages far below the average (relative gate), like EBU Tech 3341 case 3', () => {
    const quiet = stereoSine(48000 * 10, 1000, dbToGain(-36));
    const loud = stereoSine(48000 * 20, 1000, dbToGain(-23));
    // The -36 dBFS parts are above the absolute gate but 13 LU below the loud part.
    expect(Math.abs(measure(concat(quiet, loud, quiet)) - -23)).toBeLessThan(0.15);
  });

  it('reports -Infinity for silence and for an empty signal', () => {
    expect(measure(silentStem(48000 * 2))).toBe(Number.NEGATIVE_INFINITY);
    expect(new LoudnessMeter(48000).integratedLufs()).toBe(Number.NEGATIVE_INFINITY);
  });

  it('still measures a signal shorter than one 400 ms gating block', () => {
    // 0.25 s: long enough for the high-pass to settle, too short for a full block.
    const sine = stereoSine(12_000, 1000, dbToGain(-20));
    expect(Math.abs(measure(sine) - -20)).toBeLessThan(0.5);
  });

  it('tracks level changes one-to-one', () => {
    const quieter = measure(stereoSine(48000 * 3, 1000, dbToGain(-32)));
    const louder = measure(stereoSine(48000 * 3, 1000, dbToGain(-12)));
    expect(louder - quieter).toBeCloseTo(20, 1);
  });
});
