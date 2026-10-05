import { describe, expect, it } from 'vitest';
import { dbToGain } from './decibels';
import { LookAheadLimiter } from './limiter';
import { peakOf, silentStem, stereoSine } from './testSupport';

const SAMPLE_RATE = 48000;
const CEILING = dbToGain(-1);

function limit(input: Float32Array, blockFrames = 1024): Float32Array {
  const limiter = new LookAheadLimiter({ sampleRate: SAMPLE_RATE, ceiling: CEILING });
  const frames = input.length / 2;
  const output = new Float32Array(input.length);
  let written = 0;
  for (let start = 0; start < frames; start += blockFrames) {
    const count = Math.min(blockFrames, frames - start);
    const block = input.slice(start * 2, (start + count) * 2);
    const ready = limiter.process(block, count, block);
    output.set(block.subarray(0, ready * 2), written * 2);
    written += ready;
  }
  const tail = new Float32Array(limiter.lookAheadFrames * 2);
  const ready = limiter.flush(tail);
  output.set(tail.subarray(0, ready * 2), written * 2);
  written += ready;
  expect(written).toBe(frames);
  return output;
}

/** Deterministic noise in -1..1 (linear congruential generator). */
function noise(frames: number, amplitude: number): Float32Array {
  const samples = new Float32Array(frames * 2);
  let state = 12345;
  for (let index = 0; index < samples.length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    samples[index] = amplitude * (state / 0x80000000 - 1);
  }
  return samples;
}

describe('LookAheadLimiter', () => {
  it('passes audio below the ceiling through bit-for-bit, with no delay', () => {
    const input = stereoSine(20_000, 440, 0.8);
    expect(limit(input)).toEqual(input);
  });

  it.each([
    ['a sine 12 dB over full scale', stereoSine(48000, 220, 4)],
    ['a 30 Hz sine 6 dB over full scale', stereoSine(48000, 30, 2)],
    ['white noise 20 dB over full scale', noise(48000, 10)],
  ])('never lets %s past the ceiling', (_name, input) => {
    const output = limit(input);
    expect(peakOf(output)).toBeLessThanOrEqual(CEILING);
    // It limits, it does not mute: the output still reaches the ceiling region.
    expect(peakOf(output)).toBeGreaterThan(CEILING * 0.9);
  });

  it('holds the ceiling for isolated full-scale spikes, including the very first and last frame', () => {
    const input = stereoSine(10_000, 300, 0.2);
    for (const frame of [0, 1, 4999, 5000, 9998, 9999]) {
      input[frame * 2] = 3;
      input[frame * 2 + 1] = -5;
    }
    expect(peakOf(limit(input, 333))).toBeLessThanOrEqual(CEILING);
  });

  it('holds the ceiling for inputs shorter than the look-ahead', () => {
    const input = new Float32Array(20).fill(7);
    const output = limit(input);
    expect(output.length).toBe(20);
    expect(peakOf(output)).toBeLessThanOrEqual(CEILING);
    expect(peakOf(output)).toBeGreaterThan(0);
  });

  it('turns the gain down with a ramp before a peak instead of a step', () => {
    // A steady tone with one loud burst in the middle.
    const input = stereoSine(48000, 1000, 0.5);
    for (let frame = 24_000; frame < 24_480; frame++) {
      input[frame * 2] = input[frame * 2]! * 6;
      input[frame * 2 + 1] = input[frame * 2 + 1]! * 6;
    }
    const output = limit(input);

    // Gain applied to each frame, measured where the tone is not near a zero crossing.
    const gainAt = (frame: number): number => output[frame * 2]! / input[frame * 2]!;
    const usable = (frame: number): boolean => Math.abs(input[frame * 2]!) > 0.2;

    // Well before the burst nothing happens; 5 ms ahead the ramp is under way.
    expect(gainAt(23_000 + 12)).toBeCloseTo(1, 6);
    let largestStep = 0;
    let previousGain = 1;
    for (let frame = 23_700; frame < 24_000; frame++) {
      if (!usable(frame)) continue;
      const gain = gainAt(frame);
      expect(gain).toBeLessThanOrEqual(previousGain + 1e-6);
      largestStep = Math.max(largestStep, previousGain - gain);
      previousGain = gain;
    }
    expect(previousGain).toBeLessThan(0.4);
    // The drop of about 0.7 is spread over the 240-frame look-ahead; with unusable frames
    // skipped no single step is more than a few frames' worth.
    expect(largestStep).toBeLessThan(0.05);
  });

  it('recovers after a peak, within a few release times', () => {
    const input = stereoSine(48000, 1000, 0.5);
    input[2000] = 8;
    const output = limit(input);
    const lateFrame = 1000 + 48000 * 0.9 + 12;
    expect(output[lateFrame * 2]! / input[lateFrame * 2]!).toBeGreaterThan(0.999);
  });

  it('applies the same gain to both channels so the stereo image stays put', () => {
    const frames = 9600;
    const input = silentStem(frames);
    for (let frame = 0; frame < frames; frame++) {
      const phase = (2 * Math.PI * 500 * frame) / SAMPLE_RATE;
      input[frame * 2] = 3 * Math.sin(phase);
      input[frame * 2 + 1] = 0.3 * Math.sin(phase);
    }
    const output = limit(input);
    for (let frame = 2000; frame < frames; frame += 37) {
      const left = output[frame * 2]!;
      if (Math.abs(left) < 0.05) continue;
      expect(output[frame * 2 + 1]! / left).toBeCloseTo(0.1, 4);
    }
  });

  it('gives the same output however the audio is split into blocks', () => {
    const input = noise(20_000, 3);
    expect(limit(input, 17)).toEqual(limit(input, 20_000));
  });

  it('treats samples that are not finite as silence instead of passing NaN on', () => {
    const input = stereoSine(4800, 1000, 0.5);
    const reference = input.slice();
    input[2000] = Number.POSITIVE_INFINITY;
    input[2001] = Number.NaN;
    input[3000] = Number.NEGATIVE_INFINITY;
    for (const index of [2000, 2001, 3000]) reference[index] = 0;

    const output = limit(input, 333);

    expect(output.every((sample) => Number.isFinite(sample))).toBe(true);
    // Exactly what limiting the same audio with those samples silenced gives.
    expect(output).toEqual(limit(reference, 333));
    expect(output[2002]).toBe(input[2002]);
  });

  it('refuses audio after it has been flushed', () => {
    const limiter = new LookAheadLimiter({ sampleRate: SAMPLE_RATE, ceiling: CEILING });
    const block = new Float32Array(limiter.lookAheadFrames * 2);
    limiter.flush(block);
    expect(() => limiter.process(block, 1, block)).toThrow();
    expect(limiter.flush(block)).toBe(0);
  });
});
