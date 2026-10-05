// The safety stage in front of the headphones. It is a static curve — no look-ahead, no
// oversampling — so it adds no latency at all, unlike a compressor or a look-ahead limiter.
import { decibelsToGain } from '@dsp/math';

/** Levels up to here pass through unchanged. */
export const CLIP_KNEE = decibelsToGain(-2);

/** The output approaches this level and never passes it. */
export const CLIP_CEILING = 0.98;

/**
 * A WaveShaperNode only looks at inputs between -1 and 1 and clamps everything beyond, which
 * would make the curve end in a hard corner. The mix is therefore scaled down by this factor
 * before the shaper, and the curve is drawn over inputs up to ±CLIP_INPUT_RANGE (+12 dBFS).
 * A power of two, so the scaling itself is exact.
 */
export const CLIP_INPUT_RANGE = 4;

const DEFAULT_CURVE_POINTS = 8193;

/** Identity up to the knee, then a tanh bend that flattens toward the ceiling. Odd-symmetric. */
export function softClip(amplitude: number): number {
  const magnitude = Math.abs(amplitude);
  if (magnitude <= CLIP_KNEE) return amplitude;
  const headroom = CLIP_CEILING - CLIP_KNEE;
  const shaped = CLIP_KNEE + headroom * Math.tanh((magnitude - CLIP_KNEE) / headroom);
  return amplitude < 0 ? -shaped : shaped;
}

/**
 * The curve for a WaveShaperNode fed with the mix divided by CLIP_INPUT_RANGE. The node
 * interpolates linearly between points, which reproduces the straight part exactly.
 */
export function createSoftClipCurve(points = DEFAULT_CURVE_POINTS): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let n = 0; n < points; n++) {
    const input = ((2 * n) / (points - 1) - 1) * CLIP_INPUT_RANGE;
    curve[n] = softClip(input);
  }
  return curve;
}
