import type { EffectUnit } from '../effectUnit';
import { decibelsToGain, flushDenormal } from '../math';

/** Levels below this pass through untouched. */
export const LIMITER_THRESHOLD = decibelsToGain(-3);

/** The output level approaches this and never passes it. */
export const LIMITER_CEILING = 0.98;

/** How quickly the gain recovers after a peak. */
const RELEASE_SEC = 0.12;

/**
 * Stereo-linked soft limiter with no look-ahead (so it adds no latency).
 *
 * A peak envelope follows the louder channel: it jumps up instantly and falls back slowly.
 * The envelope is mapped through a soft-knee curve — identity up to the threshold, then a
 * tanh bend that flattens toward the ceiling — and both channels are scaled by
 * curve(envelope) / envelope.
 *
 * Why this can never overshoot: the envelope is always at least as large as the current
 * sample, so |output| = |sample| · curve(envelope) / envelope ≤ curve(envelope) ≤ ceiling.
 * And while the envelope is under the threshold the gain is exactly 1.
 *
 * NaN and ±Infinity samples come out as silence. As the last stage before the speakers it
 * must not rely on everything upstream staying finite: one NaN in the envelope would
 * otherwise switch the limiting off for good.
 */
export class LimiterUnit implements EffectUnit {
  readonly latencySamples = 0;

  private readonly releaseFactor: number = 0;
  private envelope = 0;

  constructor(sampleRate: number) {
    this.releaseFactor = Math.exp(-1 / (RELEASE_SEC * sampleRate));
  }

  process(left: Float32Array, right: Float32Array, frameCount: number): void {
    const releaseFactor = this.releaseFactor;
    const knee = LIMITER_CEILING - LIMITER_THRESHOLD;
    let envelope = this.envelope;
    for (let i = 0; i < frameCount; i++) {
      let sampleLeft = left[i]!;
      let sampleRight = right[i]!;
      // x - x is 0 for every finite x, and NaN for NaN and ±Infinity.
      if (sampleLeft - sampleLeft !== 0) {
        sampleLeft = 0;
        left[i] = 0;
      }
      if (sampleRight - sampleRight !== 0) {
        sampleRight = 0;
        right[i] = 0;
      }
      // Release first, then compare: the envelope must never be below the current sample.
      envelope = Math.max(envelope * releaseFactor, Math.abs(sampleLeft), Math.abs(sampleRight));
      if (envelope > LIMITER_THRESHOLD) {
        const limited = LIMITER_THRESHOLD + knee * Math.tanh((envelope - LIMITER_THRESHOLD) / knee);
        const gain = limited / envelope;
        left[i] = sampleLeft * gain;
        right[i] = sampleRight * gain;
      }
    }
    // The envelope takes minutes of digital silence to decay into the denormal range, so
    // checking once per block is enough.
    this.envelope = flushDenormal(envelope);
  }

  reset(): void {
    this.envelope = 0;
  }
}
