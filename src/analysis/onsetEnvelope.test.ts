import { describe, expect, it } from 'vitest';
import { ENVELOPE_RATE_HZ, computeOnsetEnvelope } from './onsetEnvelope';
import { SeededRandom } from './testing/random';

const SAMPLE_RATE = 16_000;

/** Short noise bursts ("clicks") at the given times on a quiet noise floor. */
function clicks(timesSec: readonly number[], durationSec: number, gain = 1): Float32Array {
  const random = new SeededRandom(3);
  const signal = Float32Array.from(
    { length: durationSec * SAMPLE_RATE },
    () => 0.001 * gain * random.noise(),
  );
  for (const time of timesSec) {
    const start = Math.round(time * SAMPLE_RATE);
    for (let n = 0; n < 0.02 * SAMPLE_RATE; n++) {
      signal[start + n]! += gain * 0.5 * Math.exp(-n / 80) * random.noise();
    }
  }
  return signal;
}

/** Frames at which the summed envelope has a clear local maximum. */
function onsetTimes(signal: Float32Array): number[] {
  const envelope = computeOnsetEnvelope(signal, SAMPLE_RATE);
  const total = new Float32Array(envelope.frameCount);
  // The bands hold each onset's spectral shape around a common mean; their absolute values
  // show where anything happened at all.
  for (const band of envelope.bands)
    band.forEach((value, frame) => (total[frame]! += Math.abs(value)));
  const peak = Math.max(...total);
  const times: number[] = [];
  for (let frame = 1; frame < total.length - 1; frame++) {
    const isPeak =
      total[frame]! > 0.5 * peak &&
      total[frame]! >= total[frame - 1]! &&
      total[frame]! > total[frame + 1]!;
    if (
      isPeak &&
      (times.length === 0 || frame / ENVELOPE_RATE_HZ - times[times.length - 1]! > 0.1)
    ) {
      times.push(frame / ENVELOPE_RATE_HZ);
    }
  }
  return times;
}

describe('computeOnsetEnvelope', () => {
  it('produces one frame every 5 ms in seven bands', () => {
    const envelope = computeOnsetEnvelope(clicks([0.5], 2), SAMPLE_RATE);
    expect(envelope.frameCount).toBe(2 * ENVELOPE_RATE_HZ);
    expect(envelope.bands.length).toBe(7);
    expect(envelope.bands.every((band) => band.length === envelope.frameCount)).toBe(true);
  });

  it('marks onsets where they happen', () => {
    const truth = [0.5, 1.1, 1.45, 2.3];
    const found = onsetTimes(clicks(truth, 3));
    expect(found.length).toBe(truth.length);
    found.forEach((time, index) => expect(Math.abs(time - truth[index]!)).toBeLessThan(0.02));
  });

  it('does not depend on the recording level', () => {
    const loud = computeOnsetEnvelope(clicks([0.5, 1.2], 2, 1), SAMPLE_RATE);
    const quiet = computeOnsetEnvelope(clicks([0.5, 1.2], 2, 0.01), SAMPLE_RATE);
    loud.bands.forEach((band, bandIndex) => {
      band.forEach((value, frame) => {
        expect(quiet.bands[bandIndex]![frame]!).toBeCloseTo(value, 3);
      });
    });
  });

  it('is all zero for silence and empty for no input', () => {
    const silent = computeOnsetEnvelope(new Float32Array(SAMPLE_RATE), SAMPLE_RATE);
    expect(silent.bands.every((band) => band.every((value) => value === 0))).toBe(true);
    expect(computeOnsetEnvelope(new Float32Array(0), SAMPLE_RATE).frameCount).toBe(0);
  });

  it('rejects sample rates that do not divide into 5 ms frames', () => {
    expect(() => computeOnsetEnvelope(new Float32Array(100), 22_050)).toThrow(RangeError);
  });
});
