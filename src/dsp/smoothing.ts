// Parameter smoothing: every control value that reaches the audio path glides to its target
// so that stepping a slider (or a gesture update arriving late) never produces zipper noise.

/** A value closer to its target than this is snapped onto it (-120 dB for a gain near 1). */
const SETTLE_EPSILON = 1e-6;

/**
 * Per-sample coefficient of a one-pole smoother with the given time constant
 * (time to cover 63% of a step). A non-positive time constant means "no smoothing".
 */
export function smoothingCoefficient(timeConstantSec: number, sampleRate: number): number {
  if (!(timeConstantSec > 0)) return 1;
  return 1 - Math.exp(-1 / (timeConstantSec * sampleRate));
}

/**
 * Exponential glide toward a target. The value lands exactly on the target once it is close,
 * so a settled unity gain is a true bit-exact pass-through.
 */
export class OnePoleSmoother {
  private current: number = 0;
  private target: number = 0;
  private coefficient: number = 0;

  constructor(initialValue: number, timeConstantSec: number, sampleRate: number) {
    this.current = initialValue;
    this.target = initialValue;
    this.coefficient = smoothingCoefficient(timeConstantSec, sampleRate);
  }

  get value(): number {
    return this.current;
  }

  get targetValue(): number {
    return this.target;
  }

  get isSettled(): boolean {
    return this.current === this.target;
  }

  setTarget(target: number): void {
    if (Number.isFinite(target)) this.target = target;
  }

  /** Jumps straight to a value (used on reset). */
  snapTo(value: number): void {
    this.current = value;
    this.target = value;
  }

  /** Advances `count` samples, writing each new value to `out[0..count)`. */
  fill(out: Float32Array, count: number): void {
    const target = this.target;
    const coefficient = this.coefficient;
    let current = this.current;
    for (let i = 0; i < count; i++) {
      if (current !== target) {
        const remaining = target - current;
        current =
          remaining < SETTLE_EPSILON && remaining > -SETTLE_EPSILON
            ? target
            : current + coefficient * remaining;
      }
      out[i] = current;
    }
    this.current = current;
  }
}
