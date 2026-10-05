import type { EffectUnit } from '../effectUnit';
import { OnePoleSmoother } from '../smoothing';

const SMOOTHING_SEC = 0.02;

/** Frames processed per pass (the size of the gain ramp buffer). */
const CHUNK_FRAMES = 128;

/** A smoothed linear gain (the vocal volume stage). Exactly transparent at a settled gain of 1. */
export class GainUnit implements EffectUnit {
  readonly latencySamples = 0;

  private readonly gain: OnePoleSmoother;
  private readonly ramp = new Float32Array(CHUNK_FRAMES);

  constructor(sampleRate: number, initialGain = 1) {
    this.gain = new OnePoleSmoother(initialGain, SMOOTHING_SEC, sampleRate);
  }

  /** Linear gain factor to glide to. Negative and non-finite values are ignored. */
  setGain(gain: number): void {
    if (gain >= 0) this.gain.setTarget(gain);
  }

  process(left: Float32Array, right: Float32Array, frameCount: number): void {
    const gain = this.gain;
    if (gain.isSettled && gain.value === 1) return;
    const ramp = this.ramp;
    for (let offset = 0; offset < frameCount; offset += CHUNK_FRAMES) {
      const frames = Math.min(CHUNK_FRAMES, frameCount - offset);
      gain.fill(ramp, frames);
      for (let i = 0; i < frames; i++) {
        left[offset + i] = left[offset + i]! * ramp[i]!;
        right[offset + i] = right[offset + i]! * ramp[i]!;
      }
    }
  }

  reset(): void {
    this.gain.snapTo(this.gain.targetValue);
  }
}
