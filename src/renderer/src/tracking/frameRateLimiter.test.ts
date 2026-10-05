import { describe, expect, it } from 'vitest';
import { FrameRateLimiter } from './frameRateLimiter';

/** Deterministic noise in −1..1. */
function createNoise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 4294967296) * 2 - 1;
  };
}

function countAccepted(limiter: FrameRateLimiter, arrivalTimesMs: readonly number[]): number {
  return arrivalTimesMs.filter((timeMs) => limiter.accept(timeMs)).length;
}

describe('FrameRateLimiter', () => {
  it('takes every frame of a camera running at the cap, despite arrival jitter', () => {
    const noise = createNoise(3);
    const arrivals = Array.from({ length: 300 }, (_, index) => (index * 1000) / 30 + 3 * noise());
    expect(countAccepted(new FrameRateLimiter(30), arrivals)).toBe(300);
  });

  it('takes every second frame of a camera running at twice the cap', () => {
    const noise = createNoise(11);
    const arrivals = Array.from({ length: 600 }, (_, index) => (index * 1000) / 60 + 2 * noise());
    const accepted = countAccepted(new FrameRateLimiter(30), arrivals);
    expect(accepted).toBeGreaterThanOrEqual(299);
    expect(accepted).toBeLessThanOrEqual(301);
  });

  it('holds a cap that does not divide the camera rate', () => {
    // 30 fps camera, 20 fps cap, ten seconds.
    const arrivals = Array.from({ length: 300 }, (_, index) => (index * 1000) / 30);
    const accepted = countAccepted(new FrameRateLimiter(20), arrivals);
    expect(accepted).toBeGreaterThanOrEqual(199);
    expect(accepted).toBeLessThanOrEqual(201);
  });

  it('never exceeds the cap over any one-second window, however frames arrive', () => {
    const noise = createNoise(5);
    const limiter = new FrameRateLimiter(30);
    const accepted: number[] = [];
    let timeMs = 0;
    for (let index = 0; index < 5000; index += 1) {
      timeMs += 1 + 9 * Math.abs(noise());
      if (limiter.accept(timeMs)) accepted.push(timeMs);
    }
    for (let index = 0; index < accepted.length; index += 1) {
      const windowStart = accepted[index] ?? 0;
      const inWindow = accepted.filter((time) => time >= windowStart && time < windowStart + 1000);
      // One extra is the jitter allowance at the window's edge.
      expect(inWindow.length).toBeLessThanOrEqual(31);
    }
    expect(accepted.length).toBeGreaterThan(100);
  });

  it('does not pay back a stall with a burst', () => {
    const limiter = new FrameRateLimiter(30);
    expect(limiter.accept(0)).toBe(true);
    // Nothing for two seconds, then frames arrive 6 ms apart.
    const burst = [2000, 2006, 2012, 2018, 2024, 2030, 2036, 2042];
    expect(burst.map((timeMs) => limiter.accept(timeMs))).toEqual([
      true,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it('accepts the next frame immediately after reset', () => {
    const limiter = new FrameRateLimiter(30);
    expect(limiter.accept(1000)).toBe(true);
    expect(limiter.accept(1005)).toBe(false);
    limiter.reset();
    expect(limiter.accept(1006)).toBe(true);
  });

  it('rejects a cap that is not a positive number instead of silently taking every frame', () => {
    for (const maxFps of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new FrameRateLimiter(maxFps), `maxFps ${maxFps}`).toThrow(RangeError);
    }
  });
});
