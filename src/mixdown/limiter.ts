import { STEM_CHANNELS } from '@shared/take';

export interface LimiterOptions {
  sampleRate: number;
  /** Largest output magnitude, as a linear amplitude (e.g. 0.891 for -1 dBFS). */
  ceiling: number;
  /** How far ahead the limiter sees a peak coming; also its attack time. */
  lookAheadSec?: number;
  releaseSec?: number;
}

// A module-local copy: imported bindings are slow to read inside per-sample loops under
// the test runner's module transform.
const CHANNELS = STEM_CHANNELS;
const DEFAULT_LOOK_AHEAD_SEC = 0.005;
const DEFAULT_RELEASE_SEC = 0.1;

/** Largest float32 that does not exceed `value` (for positive values). */
function floorToFloat32(value: number): number {
  const floats = new Float32Array([value]);
  if (floats[0]! > value) {
    // Positive floats are ordered like their bit patterns, so one less is the next one down.
    const bits = new Uint32Array(floats.buffer);
    bits[0] = bits[0]! - 1;
  }
  return floats[0]!;
}

/**
 * Stereo-linked look-ahead peak limiter for interleaved stereo audio.
 *
 * For every frame it works out the gain that frame needs to stay under the ceiling, then:
 *   1. takes the minimum of that gain over the look-ahead window (so the reduction is held
 *      from the moment a peak comes into view until it has passed),
 *   2. lets the held gain recover exponentially (release),
 *   3. averages it over one window length, which turns each step down into a click-free ramp.
 * The audio is delayed by the look-ahead, so the ramp completes exactly when the peak is
 * output. Because the average only ever contains values at or below what the frame being
 * output needs, the ceiling cannot be exceeded. Both channels always get the same gain, so
 * the stereo image does not shift. Samples that are not finite are treated as silence, so
 * the output is always finite.
 *
 * The delay is hidden from the caller: process() swallows the first look-ahead frames and
 * flush() returns the last ones, so frame N out is frame N in.
 */
export class LookAheadLimiter {
  readonly lookAheadFrames: number;
  private readonly windowFrames: number;
  private readonly ceiling: number;
  private readonly outputClamp: number;
  private readonly releaseCoefficient: number;

  private readonly delayLine: Float32Array;
  private delayIndex = 0;

  /** Monotonic queue of (frame number, required gain): the head is the window minimum. */
  private readonly queueGains: Float64Array;
  private readonly queueFrames: Float64Array;
  private queueHead = 0;
  private queueSize = 0;

  private heldGain = 1;
  private readonly smoothingRing: Float64Array;
  private smoothingIndex = 0;
  private smoothingSum: number;

  private framesIn = 0;
  private flushed = false;

  constructor(options: LimiterOptions) {
    const lookAheadSec = options.lookAheadSec ?? DEFAULT_LOOK_AHEAD_SEC;
    const releaseSec = options.releaseSec ?? DEFAULT_RELEASE_SEC;
    this.lookAheadFrames = Math.max(1, Math.round(lookAheadSec * options.sampleRate));
    this.windowFrames = this.lookAheadFrames + 1;
    this.ceiling = options.ceiling;
    this.outputClamp = floorToFloat32(options.ceiling);
    this.releaseCoefficient = Math.exp(-1 / (releaseSec * options.sampleRate));

    this.delayLine = new Float32Array(this.lookAheadFrames * CHANNELS);
    this.queueGains = new Float64Array(this.windowFrames);
    this.queueFrames = new Float64Array(this.windowFrames);
    this.smoothingRing = new Float64Array(this.windowFrames).fill(1);
    this.smoothingSum = this.windowFrames;
  }

  /**
   * Limits `frameCount` frames of `input` and writes the frames that are ready to `output`
   * (which may be the same array). Returns how many frames were written.
   */
  process(input: Float32Array, frameCount: number, output: Float32Array): number {
    if (this.flushed) throw new Error('The limiter has already been flushed');
    return this.run(input, frameCount, output);
  }

  /**
   * Writes the frames still held in the look-ahead delay (at most lookAheadFrames) and
   * returns how many there were. The limiter cannot be used afterwards.
   */
  flush(output: Float32Array): number {
    if (this.flushed) return 0;
    this.flushed = true;
    // Feeding one look-ahead of silence pushes every held frame out.
    const silence = new Float32Array(this.lookAheadFrames * CHANNELS);
    return this.run(silence, this.lookAheadFrames, output);
  }

  private run(input: Float32Array, frameCount: number, output: Float32Array): number {
    const { windowFrames, lookAheadFrames, ceiling, outputClamp, releaseCoefficient } = this;
    const { delayLine, queueGains, queueFrames, smoothingRing } = this;
    let { delayIndex, queueHead, queueSize, heldGain, smoothingIndex, smoothingSum } = this;
    let frameNumber = this.framesIn;
    let written = 0;

    for (let frame = 0; frame < frameCount; frame++, frameNumber++) {
      let left = input[frame * CHANNELS]!;
      let right = input[frame * CHANNELS + 1]!;
      // No gain brings Infinity or NaN under the ceiling (Infinity x 0 is NaN), so such a
      // sample is dropped instead.
      if (!Number.isFinite(left)) left = 0;
      if (!Number.isFinite(right)) right = 0;
      const peak = Math.max(Math.abs(left), Math.abs(right));
      const requiredGain = peak > ceiling ? ceiling / peak : 1;

      // Sliding-window minimum: drop queued gains that can no longer be the minimum.
      while (queueSize > 0) {
        const tail = (queueHead + queueSize - 1) % windowFrames;
        if (queueGains[tail]! < requiredGain) break;
        queueSize -= 1;
      }
      if (queueSize > 0 && queueFrames[queueHead]! <= frameNumber - windowFrames) {
        queueHead = (queueHead + 1) % windowFrames;
        queueSize -= 1;
      }
      const slot = (queueHead + queueSize) % windowFrames;
      queueGains[slot] = requiredGain;
      queueFrames[slot] = frameNumber;
      queueSize += 1;
      const windowMinimum = queueGains[queueHead]!;

      heldGain =
        windowMinimum < heldGain
          ? windowMinimum
          : windowMinimum + (heldGain - windowMinimum) * releaseCoefficient;

      smoothingSum += heldGain - smoothingRing[smoothingIndex]!;
      smoothingRing[smoothingIndex] = heldGain;
      smoothingIndex += 1;
      if (smoothingIndex === windowFrames) {
        smoothingIndex = 0;
        // Re-add from scratch once per window so rounding errors cannot build up.
        smoothingSum = 0;
        for (let index = 0; index < windowFrames; index++) smoothingSum += smoothingRing[index]!;
      }
      const gain = Math.min(1, smoothingSum / windowFrames);

      const delayedLeft = delayLine[delayIndex]!;
      const delayedRight = delayLine[delayIndex + 1]!;
      delayLine[delayIndex] = left;
      delayLine[delayIndex + 1] = right;
      delayIndex += CHANNELS;
      if (delayIndex === delayLine.length) delayIndex = 0;

      if (frameNumber >= lookAheadFrames) {
        // The clamp only guards against the last bit of floating-point rounding.
        output[written * CHANNELS] = Math.max(
          -outputClamp,
          Math.min(outputClamp, delayedLeft * gain),
        );
        output[written * CHANNELS + 1] = Math.max(
          -outputClamp,
          Math.min(outputClamp, delayedRight * gain),
        );
        written += 1;
      }
    }

    this.delayIndex = delayIndex;
    this.queueHead = queueHead;
    this.queueSize = queueSize;
    this.heldGain = heldGain;
    this.smoothingIndex = smoothingIndex;
    this.smoothingSum = smoothingSum;
    this.framesIn = frameNumber;
    return written;
  }
}
