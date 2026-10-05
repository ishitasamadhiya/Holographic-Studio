import { describe, expect, it } from 'vitest';
import { applyEdgeFades } from './edgeFades';

function constantBlock(frames: number): Float32Array {
  return new Float32Array(frames * 2).fill(1);
}

describe('applyEdgeFades', () => {
  it('fades in from silence at the start and out to silence at the end', () => {
    const block = constantBlock(1000);
    applyEdgeFades(block, 1000, 0, 1000, 100);
    expect(block[0]).toBe(0);
    expect(block[1]).toBe(0);
    expect(block[50 * 2]).toBeCloseTo(0.5, 6);
    expect(block[100 * 2]).toBe(1);
    expect(block[500 * 2]).toBe(1);
    expect(block[899 * 2]).toBe(1);
    expect(block[949 * 2 + 1]).toBeCloseTo(0.5, 6);
    expect(block[999 * 2]).toBe(0);
    for (let frame = 1; frame < 100; frame++) {
      expect(block[frame * 2]!).toBeGreaterThan(block[(frame - 1) * 2]!);
    }
  });

  it('leaves blocks from the middle of the programme untouched', () => {
    const block = constantBlock(500);
    applyEdgeFades(block, 500, 2000, 10_000, 240);
    expect(block).toEqual(constantBlock(500));
  });

  it('produces the same result when the programme is processed in pieces', () => {
    const whole = constantBlock(900);
    applyEdgeFades(whole, 900, 0, 900, 240);

    const pieces = constantBlock(900);
    for (let start = 0; start < 900; start += 128) {
      const frames = Math.min(128, 900 - start);
      applyEdgeFades(pieces.subarray(start * 2, (start + frames) * 2), frames, start, 900, 240);
    }
    expect(pieces).toEqual(whole);
  });

  it('shortens the fades for a programme shorter than two fades', () => {
    const block = constantBlock(10);
    applyEdgeFades(block, 10, 0, 10, 240);
    expect(block[0]).toBe(0);
    expect(block[9 * 2]).toBe(0);
    expect(block[4 * 2]!).toBeGreaterThan(0.5);
  });
});
