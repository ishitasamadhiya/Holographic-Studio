import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from './oneEuroFilter';

const FRAME_MS = 1000 / 30;

/** Deterministic noise in −1..1 (a small linear congruential generator). */
function createNoise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 4294967296) * 2 - 1;
  };
}

function rootMeanSquare(values: readonly number[]): number {
  return Math.sqrt(values.reduce((total, value) => total + value * value, 0) / values.length);
}

describe('OneEuroFilter', () => {
  it('passes the first sample through unchanged', () => {
    expect(new OneEuroFilter().filter(0.42, 1000)).toBe(0.42);
  });

  it('ignores a sample that is not a finite number, instead of keeping it for good', () => {
    for (const broken of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const filter = new OneEuroFilter();
      filter.filter(0.4, 0);
      filter.filter(0.4, FRAME_MS);
      expect(filter.filter(broken, 2 * FRAME_MS)).toBe(0.4);
      expect(filter.filter(0.4, broken)).toBe(0.4);
      // The state is intact: the filter goes on exactly as one that never saw the bad samples.
      const untouched = new OneEuroFilter();
      untouched.filter(0.4, 0);
      untouched.filter(0.4, FRAME_MS);
      for (let frame = 3; frame < 10; frame += 1) {
        const value = 0.4 + 0.05 * frame;
        expect(filter.filter(value, frame * FRAME_MS)).toBe(
          untouched.filter(value, frame * FRAME_MS),
        );
      }
    }
  });

  it('rejects jitter while the hand is at rest', () => {
    const filter = new OneEuroFilter();
    const noise = createNoise(7);
    const inputErrors: number[] = [];
    const outputErrors: number[] = [];
    for (let frame = 0; frame < 300; frame += 1) {
      const jitter = 0.01 * noise();
      const output = filter.filter(0.6 + jitter, frame * FRAME_MS);
      if (frame >= 30) {
        inputErrors.push(jitter);
        outputErrors.push(output - 0.6);
      }
    }
    // At least two thirds of the jitter is gone.
    expect(rootMeanSquare(outputErrors)).toBeLessThan(rootMeanSquare(inputErrors) / 3);
  });

  it('follows a fast move with little lag', () => {
    const filter = new OneEuroFilter();
    let timeMs = 0;
    for (let frame = 0; frame < 30; frame += 1) {
      filter.filter(0, timeMs);
      timeMs += FRAME_MS;
    }
    // The hand opens fully in 200 ms (six frames), then stays open.
    let output = 0;
    for (let frame = 1; frame <= 6; frame += 1) {
      output = filter.filter(frame / 6, timeMs);
      timeMs += FRAME_MS;
    }
    expect(output).toBeGreaterThan(0.8);
    for (let frame = 0; frame < 3; frame += 1) {
      output = filter.filter(1, timeMs);
      timeMs += FRAME_MS;
    }
    expect(output).toBeGreaterThan(0.97);
  });

  it('is far quicker on that move than a fixed filter with the same resting smoothness', () => {
    const adaptive = new OneEuroFilter();
    const fixed = new OneEuroFilter({ minCutoffHz: 1, speedCoefficient: 0, derivativeCutoffHz: 1 });
    let adaptiveOutput = 0;
    let fixedOutput = 0;
    adaptive.filter(0, 0);
    fixed.filter(0, 0);
    for (let frame = 1; frame <= 6; frame += 1) {
      adaptiveOutput = adaptive.filter(frame / 6, frame * FRAME_MS);
      fixedOutput = fixed.filter(frame / 6, frame * FRAME_MS);
    }
    expect(fixedOutput).toBeLessThan(0.5);
    expect(adaptiveOutput - fixedOutput).toBeGreaterThan(0.3);
  });

  it('never overshoots a step', () => {
    const filter = new OneEuroFilter();
    filter.filter(0.2, 0);
    let previous = 0.2;
    for (let frame = 1; frame <= 60; frame += 1) {
      const output = filter.filter(0.9, frame * FRAME_MS);
      expect(output).toBeGreaterThanOrEqual(previous);
      expect(output).toBeLessThanOrEqual(0.9);
      previous = output;
    }
    expect(previous).toBeCloseTo(0.9, 3);
  });

  it('works from timestamps, so a slower frame rate gives the same response over time', () => {
    const responseAfter400Ms = (frameMs: number): number => {
      const filter = new OneEuroFilter({
        minCutoffHz: 1,
        speedCoefficient: 0,
        derivativeCutoffHz: 1,
      });
      filter.filter(0, 0);
      let output = 0;
      for (let timeMs = frameMs; timeMs <= 400; timeMs += frameMs) {
        output = filter.filter(1, timeMs);
      }
      return output;
    };
    expect(responseAfter400Ms(40)).toBeCloseTo(responseAfter400Ms(20), 1);
  });

  it('ignores a repeated or out-of-order timestamp', () => {
    const filter = new OneEuroFilter();
    filter.filter(0.5, 100);
    const settled = filter.filter(0.6, 133);
    expect(filter.filter(0.9, 133)).toBe(settled);
    expect(filter.filter(0.1, 90)).toBe(settled);
  });

  it('starts afresh after reset', () => {
    const filter = new OneEuroFilter();
    filter.filter(0.1, 0);
    filter.filter(0.2, 33);
    filter.reset();
    expect(filter.filter(0.8, 66)).toBe(0.8);
  });
});
