// Small numeric helpers shared by every DSP module. Everything here is allocation-free.

/** ratio = exp(semitones * SEMITONE_LN) */
export const SEMITONE_LN = Math.LN2 / 12;

/** Largest magnitude a sample may have inside the chain; anything beyond is a fault upstream. */
export const SAMPLE_CEILING = 8;

/** Far below anything audible (-400 dBFS), far above where floating-point denormals start. */
export const DENORMAL_FLOOR = 1e-20;

/** Clamps `value` into [min, max]. NaN is returned unchanged. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function semitonesToRatio(semitones: number): number {
  return Math.exp(semitones * SEMITONE_LN);
}

export function decibelsToGain(decibels: number): number {
  return 10 ** (decibels / 20);
}

/** Smallest power of two that is >= value (and >= 1). */
export function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < value) power *= 2;
  return power;
}

/**
 * Snaps a decaying filter state to zero once it is inaudibly small. Without this, tails decay
 * into the denormal range, where arithmetic can be an order of magnitude slower on some CPUs.
 */
export function flushDenormal(value: number): number {
  return value < DENORMAL_FLOOR && value > -DENORMAL_FLOOR ? 0 : value;
}

/**
 * Position of the top of the parabola through three equally spaced points, relative to the
 * centre point (-0.5..0.5). Returns 0 when the centre is not a local maximum.
 */
export function parabolicPeakOffset(left: number, center: number, right: number): number {
  const curvature = left - 2 * center + right;
  if (!(curvature < 0)) return 0;
  return clamp((0.5 * (left - right)) / curvature, -0.5, 0.5);
}

/** Height of that parabola at the offset returned by parabolicPeakOffset. */
export function parabolicPeakValue(
  left: number,
  center: number,
  right: number,
  offset: number,
): number {
  return center - 0.25 * (left - right) * offset;
}
