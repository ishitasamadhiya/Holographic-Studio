import { describe, expect, it } from 'vitest';
import { computeNsdf, NsdfPeaks } from './nsdf';

const WINDOW = 256;
const MAX_LAG = 116;

function sine(period: number, amplitude = 1, length = WINDOW): Float32Array {
  const samples = new Float32Array(length);
  for (let n = 0; n < length; n++) samples[n] = amplitude * Math.sin((2 * Math.PI * n) / period);
  return samples;
}

function nsdfOf(samples: Float32Array, offset = 0): Float32Array {
  const nsdf = new Float32Array(MAX_LAG + 2);
  computeNsdf(samples, offset, WINDOW, MAX_LAG + 1, nsdf);
  return nsdf;
}

/** An artificial NSDF with one raised-cosine lobe per [lag, height] pair and valleys between. */
function lobes(...peaks: [lag: number, height: number][]): Float32Array {
  const nsdf = new Float32Array(MAX_LAG + 2).fill(-0.5);
  nsdf[0] = 1;
  nsdf[1] = 0.6;
  nsdf[2] = 0.1;
  for (const [lag, height] of peaks) {
    for (let offset = -4; offset <= 4; offset++) {
      nsdf[lag + offset] = height * Math.cos((offset * Math.PI) / 10);
    }
  }
  return nsdf;
}

describe('computeNsdf', () => {
  it('is +1 at the period of a periodic signal and -1 half a period away', () => {
    const nsdf = nsdfOf(sine(40));
    expect(nsdf[0]).toBe(1);
    expect(nsdf[40]).toBeGreaterThan(0.999);
    expect(nsdf[80]).toBeGreaterThan(0.999);
    expect(nsdf[20]).toBeLessThan(-0.999);
    expect(nsdf[10]).toBeCloseTo(0, 1);
  });

  it('does not depend on the signal level', () => {
    const loud = nsdfOf(sine(33.3, 0.9));
    const quiet = nsdfOf(sine(33.3, 0.003));
    for (let lag = 0; lag <= MAX_LAG; lag++) expect(quiet[lag]).toBeCloseTo(loud[lag]!, 4);
  });

  it('honours the window offset', () => {
    const padded = new Float32Array(WINDOW + 50);
    padded.set(sine(40), 50);
    const shifted = nsdfOf(padded, 50);
    const direct = nsdfOf(sine(40));
    for (let lag = 0; lag <= MAX_LAG; lag++) expect(shifted[lag]).toBe(direct[lag]);
  });

  it('is all zero for silence', () => {
    const nsdf = nsdfOf(new Float32Array(WINDOW));
    expect(Array.from(nsdf).every((value) => value === 0)).toBe(true);
  });

  it('stays within [-1, 1]', () => {
    let state = 12345;
    const noise = new Float32Array(WINDOW);
    for (let n = 0; n < WINDOW; n++) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      noise[n] = state / 2 ** 31 - 1;
    }
    for (const value of nsdfOf(noise)) {
      expect(value).toBeLessThanOrEqual(1 + 1e-6);
      expect(value).toBeGreaterThanOrEqual(-1 - 1e-6);
    }
  });
});

describe('NsdfPeaks', () => {
  const peaks = new NsdfPeaks(MAX_LAG + 1);

  it('finds one lobe per multiple of the period, interpolated between lags', () => {
    for (const period of [8.4, 17.25, 40.3, 77.7, 110.2]) {
      peaks.find(nsdfOf(sine(period)), 7, MAX_LAG);
      expect(peaks.count).toBe(Math.floor(MAX_LAG / period));
      for (let i = 0; i < peaks.count; i++) {
        expect(Math.abs(peaks.lag(i) - (i + 1) * period)).toBeLessThan(0.08);
        expect(peaks.height(i)).toBeGreaterThan(0.98);
        expect(peaks.height(i)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('finds nothing in silence or in a featureless function', () => {
    peaks.find(nsdfOf(new Float32Array(WINDOW)), 7, MAX_LAG);
    expect(peaks.count).toBe(0);
    peaks.find(new Float32Array(MAX_LAG + 2).fill(0.5), 7, MAX_LAG);
    expect(peaks.count).toBe(0);
  });

  it('ignores lobes below the minimum lag and lobes still rising at the maximum lag', () => {
    // Period 5 is too short to be a pitch; only its multiples inside the range are lobes.
    peaks.find(nsdfOf(sine(5)), 7, MAX_LAG);
    expect(peaks.lag(0)).toBeCloseTo(10, 1);

    const rising = new Float32Array(MAX_LAG + 2).fill(-0.5);
    for (let lag = MAX_LAG - 6; lag <= MAX_LAG + 1; lag++) rising[lag] = 0.1 * (lag - MAX_LAG + 7);
    peaks.find(rising, 7, MAX_LAG);
    expect(peaks.count).toBe(0);
  });

  it('measures the height of a lobe whose top falls between two lags', () => {
    // A lobe centred on 30.5: the two highest samples are both below the true top of 1.
    const nsdf = new Float32Array(MAX_LAG + 2).fill(-0.5);
    for (let lag = 26; lag <= 35; lag++) nsdf[lag] = 1 - 0.04 * (lag - 30.5) * (lag - 30.5);
    peaks.find(nsdf, 7, MAX_LAG);
    expect(peaks.count).toBe(1);
    expect(nsdf[30]).toBeCloseTo(0.99, 6);
    expect(peaks.lag(0)).toBeCloseTo(30.5, 5);
    expect(peaks.height(0)).toBeCloseTo(1, 5);
  });

  it('knows the highest lobe and the first lobe nearly as high (the MPM choice)', () => {
    peaks.find(lobes([30, 0.96], [60, 1], [90, 0.98]), 7, MAX_LAG);
    expect(peaks.count).toBe(3);
    expect(peaks.highestIndex).toBe(1);
    expect(peaks.firstReaching(0.95)).toBe(0);
    expect(peaks.firstReaching(0.97)).toBe(1);
    // A lobe that is clearly lower is a harmonic, not the period.
    peaks.find(lobes([30, 0.8], [60, 0.99], [90, 1]), 7, MAX_LAG);
    expect(peaks.highestIndex).toBe(2);
    expect(peaks.firstReaching(0.95)).toBe(1);
  });

  it('finds the lobe that continues a tracked period, within a tolerance', () => {
    peaks.find(lobes([30, 0.9], [60, 1], [90, 0.95]), 7, MAX_LAG);
    expect(peaks.nearest(31.5, 0.2)).toBe(0);
    expect(peaks.nearest(57, 0.2)).toBe(1);
    expect(peaks.nearest(44, 0.2)).toBe(-1);
    expect(peaks.nearest(72, 0.25)).toBe(1);
    expect(peaks.nearest(80, 0.25)).toBe(2);
  });
});
