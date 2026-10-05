import { describe, expect, it } from 'vitest';
import { BiquadHighpass } from './filters';

const SAMPLE_RATE = 48000;

interface Filter {
  process(input: number): number;
  reset(): void;
}

/** Steady-state gain of a filter for a sine of the given frequency. */
function gainAt(filter: Filter, frequencyHz: number): number {
  filter.reset();
  const settle = SAMPLE_RATE;
  const measure = SAMPLE_RATE / 2;
  let inputPower = 0;
  let outputPower = 0;
  for (let n = 0; n < settle + measure; n++) {
    const input = Math.sin((2 * Math.PI * frequencyHz * n) / SAMPLE_RATE);
    const output = filter.process(input);
    if (n >= settle) {
      inputPower += input * input;
      outputPower += output * output;
    }
  }
  return Math.sqrt(outputPower / inputPower);
}

function decibels(gain: number): number {
  return 20 * Math.log10(gain);
}

describe('BiquadHighpass', () => {
  const biquad = new BiquadHighpass(55, SAMPLE_RATE);
  // The biquad works on blocks; adapt it to the one-sample-at-a-time helper above.
  const one = new Float32Array(1);
  const filter: Filter = {
    process(input) {
      one[0] = input;
      biquad.processBlock(one, 0, 1, one);
      return one[0]!;
    },
    reset: () => biquad.reset(),
  };

  it('is 3 dB down at its cutoff and falls at about 12 dB per octave below it', () => {
    expect(decibels(gainAt(filter, 55))).toBeCloseTo(-3, 0);
    const octave = decibels(gainAt(filter, 20)) - decibels(gainAt(filter, 10));
    expect(octave).toBeGreaterThan(10);
    expect(octave).toBeLessThan(13);
  });

  it('leaves the pitch range alone', () => {
    for (const frequencyHz of [200, 1000, 5000]) {
      expect(Math.abs(decibels(gainAt(filter, frequencyHz)))).toBeLessThan(0.2);
    }
  });

  it('gives the same result for any block size', () => {
    const input = new Float32Array(1000);
    for (let n = 0; n < input.length; n++) input[n] = Math.sin(n * 0.05) + 0.3 * Math.sin(n * 1.7);
    biquad.reset();
    const whole = new Float32Array(input.length);
    biquad.processBlock(input, 0, input.length, whole);
    biquad.reset();
    const pieces = new Float32Array(input.length);
    const scratch = new Float32Array(64);
    for (let offset = 0; offset < input.length;) {
      const count = Math.min(1 + ((offset * 7) % 64), input.length - offset);
      biquad.processBlock(input, offset, count, scratch);
      pieces.set(scratch.subarray(0, count), offset);
      offset += count;
    }
    expect(Array.from(pieces)).toEqual(Array.from(whole));
  });

  it('removes a DC offset and decays to exact silence', () => {
    filter.reset();
    let output = 1;
    for (let n = 0; n < SAMPLE_RATE; n++) output = filter.process(0.5);
    expect(Math.abs(output)).toBeLessThan(1e-6);
    for (let n = 0; n < 10 * SAMPLE_RATE; n++) output = filter.process(0);
    expect(output).toBe(0);
  });
});
