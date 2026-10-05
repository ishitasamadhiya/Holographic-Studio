import { describe, expect, it } from 'vitest';
import {
  CLIP_CEILING,
  CLIP_INPUT_RANGE,
  CLIP_KNEE,
  createSoftClipCurve,
  softClip,
} from './softClipper';

/** What a WaveShaperNode (oversample 'none') outputs for one input sample. */
function waveShaper(curve: Float32Array, input: number): number {
  const position = ((curve.length - 1) / 2) * (Math.min(1, Math.max(-1, input)) + 1);
  const index = Math.min(curve.length - 2, Math.floor(position));
  const fraction = position - index;
  return (1 - fraction) * curve[index]! + fraction * curve[index + 1]!;
}

describe('softClip', () => {
  it('leaves everything below about -2 dBFS untouched', () => {
    expect(CLIP_KNEE).toBeCloseTo(0.794, 3);
    for (const level of [0, 1e-6, 0.1, -0.5, 0.79, -0.79]) expect(softClip(level)).toBe(level);
  });

  it('bends smoothly above the knee and never passes the ceiling', () => {
    let previous = softClip(CLIP_KNEE);
    for (let level = CLIP_KNEE; level <= 8; level += 0.001) {
      const shaped = softClip(level);
      expect(shaped).toBeGreaterThanOrEqual(previous);
      expect(shaped).toBeLessThanOrEqual(level);
      expect(shaped).toBeLessThanOrEqual(CLIP_CEILING);
      // Slope 1 at the knee falling to 0: no corner anywhere.
      expect(shaped - previous).toBeLessThanOrEqual(0.001 + 1e-12);
      previous = shaped;
    }
    expect(softClip(1)).toBeGreaterThan(0.9);
    expect(softClip(8)).toBeCloseTo(CLIP_CEILING, 6);
  });

  it('is odd-symmetric', () => {
    for (const level of [0.3, 0.85, 1, 2.5]) expect(softClip(-level)).toBe(-softClip(level));
  });
});

describe('createSoftClipCurve', () => {
  const curve = createSoftClipCurve();

  it('maps silence to silence exactly, so the shaper adds no DC', () => {
    expect(curve.length % 2).toBe(1);
    expect(curve[(curve.length - 1) / 2]).toBe(0);
  });

  it('is transparent below the knee when driven with the scaled-down mix', () => {
    for (let level = -0.79; level <= 0.79; level += 0.0123) {
      const output = waveShaper(curve, level / CLIP_INPUT_RANGE);
      expect(Math.abs(output - level)).toBeLessThan(1e-6);
    }
  });

  it('follows the soft-clip curve above the knee and holds the ceiling beyond its range', () => {
    for (const level of [0.8, 0.9, 1, 1.5, 2, 3.9]) {
      expect(waveShaper(curve, level / CLIP_INPUT_RANGE)).toBeCloseTo(softClip(level), 5);
      expect(waveShaper(curve, -level / CLIP_INPUT_RANGE)).toBeCloseTo(-softClip(level), 5);
    }
    // The curve is stored as 32-bit floats, so the ceiling is the nearest float to 0.98.
    expect(waveShaper(curve, 100)).toBe(Math.fround(CLIP_CEILING));
    expect(waveShaper(curve, -100)).toBe(-Math.fround(CLIP_CEILING));
  });
});
