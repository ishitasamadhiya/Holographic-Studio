import { describe, expect, it } from 'vitest';
import { RealFft, isPowerOfTwo, nextPowerOfTwo } from './fft';
import { SeededRandom } from './testing/random';

/** Textbook O(N^2) transform, the reference the FFT is checked against. */
function directDft(input: number[], size: number): { re: number[]; im: number[] } {
  const re: number[] = [];
  const im: number[] = [];
  for (let bin = 0; bin <= size / 2; bin++) {
    let sumRe = 0;
    let sumIm = 0;
    for (let n = 0; n < input.length; n++) {
      const angle = (-2 * Math.PI * bin * n) / size;
      sumRe += input[n]! * Math.cos(angle);
      sumIm += input[n]! * Math.sin(angle);
    }
    re.push(sumRe);
    im.push(sumIm);
  }
  return { re, im };
}

function randomSignal(length: number, seed: number): number[] {
  const random = new SeededRandom(seed);
  return Array.from({ length }, () => random.noise());
}

function maxDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let worst = 0;
  for (let index = 0; index < a.length; index++) {
    worst = Math.max(worst, Math.abs(a[index]! - b[index]!));
  }
  return worst;
}

describe('RealFft', () => {
  it.each([4, 8, 16, 64, 256, 1024])('matches a direct DFT at size %i', (size) => {
    const input = randomSignal(size, size);
    const fft = new RealFft(size);
    const re = new Float64Array(fft.binCount);
    const im = new Float64Array(fft.binCount);
    fft.forward(input, re, im);
    const expected = directDft(input, size);
    expect(fft.binCount).toBe(size / 2 + 1);
    expect(maxDifference(re, expected.re)).toBeLessThan(1e-9);
    expect(maxDifference(im, expected.im)).toBeLessThan(1e-9);
  });

  it('zero-pads input that is shorter than the transform', () => {
    const input = randomSignal(100, 7);
    const fft = new RealFft(256);
    const re = new Float64Array(fft.binCount);
    const im = new Float64Array(fft.binCount);
    fft.forward(input, re, im);
    const expected = directDft(input, 256);
    expect(maxDifference(re, expected.re)).toBeLessThan(1e-9);
    expect(maxDifference(im, expected.im)).toBeLessThan(1e-9);
  });

  it('puts a cosine in exactly one bin', () => {
    const size = 128;
    const input = Array.from({ length: size }, (_, n) => Math.cos((2 * Math.PI * 5 * n) / size));
    const fft = new RealFft(size);
    const re = new Float64Array(fft.binCount);
    const im = new Float64Array(fft.binCount);
    fft.forward(input, re, im);
    for (let bin = 0; bin < fft.binCount; bin++) {
      expect(re[bin]).toBeCloseTo(bin === 5 ? size / 2 : 0, 9);
      expect(im[bin]).toBeCloseTo(0, 9);
    }
  });

  it('inverts its own forward transform', () => {
    const size = 512;
    const input = randomSignal(size, 99);
    const fft = new RealFft(size);
    const re = new Float64Array(fft.binCount);
    const im = new Float64Array(fft.binCount);
    const output = new Float64Array(size);
    fft.forward(input, re, im);
    fft.inverse(re, im, output);
    expect(maxDifference(output, input)).toBeLessThan(1e-12);
  });

  it('gives the same answer when an instance is reused', () => {
    const fft = new RealFft(64);
    const first = randomSignal(64, 1);
    const second = randomSignal(64, 2);
    const re = new Float64Array(fft.binCount);
    const im = new Float64Array(fft.binCount);
    fft.forward(first, re, im);
    fft.forward(second, re, im);
    const expected = directDft(second, 64);
    expect(maxDifference(re, expected.re)).toBeLessThan(1e-9);
    expect(maxDifference(im, expected.im)).toBeLessThan(1e-9);
  });

  it('rejects sizes that are not a power of two', () => {
    expect(() => new RealFft(1000)).toThrow(RangeError);
    expect(() => new RealFft(2)).toThrow(RangeError);
    expect(() => new RealFft(0)).toThrow(RangeError);
  });
});

describe('power-of-two helpers', () => {
  it('recognises powers of two', () => {
    expect([1, 2, 1024].every(isPowerOfTwo)).toBe(true);
    expect([0, 3, 1000, 2.5, -4].some(isPowerOfTwo)).toBe(false);
  });

  it('rounds up to the next power of two', () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(1024)).toBe(1024);
    expect(nextPowerOfTwo(1025)).toBe(2048);
  });
});
