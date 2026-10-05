import { clamp01 } from '@shared/controls';
import type { EffectUnit } from '../effectUnit';
import { DENORMAL_FLOOR, flushDenormal, nextPowerOfTwo } from '../math';
import { echoFeedback, echoWet, limitEchoFeedback } from '../parameterMapping';
import { OnePoleSmoother } from '../smoothing';

/** Time between repeats: a dotted-eighth-ish slap that sits well under most pop tempos. */
export const ECHO_DELAY_SEC = 0.3;

/**
 * The left repeat arrives this fraction early and the right one this fraction late (±4.5 ms).
 * Together with the cross-feed it spreads the echoes around the dry voice, which stays centred.
 */
const STEREO_OFFSET = 0.015;

/** Share of each channel's feedback that goes to the other channel. */
const CROSS_FEED = 0.25;

/** Each trip round the loop loses highs and lows, like a tape echo: repeats get darker and thinner. */
const FEEDBACK_LOWPASS_HZ = 3200;
const FEEDBACK_HIGHPASS_HZ = 160;

const SMOOTHING_SEC = 0.03;

/** Frames processed per pass (the size of the parameter ramp buffers). */
const CHUNK_FRAMES = 128;

/** Per-sample coefficient of a one-pole (6 dB/octave) low-pass with the given cutoff. */
function onePoleCoefficient(cutoffHz: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
}

/**
 * Stereo feedback echo.
 *
 * The intensity controls how much of the voice is SENT into the delay, not how loud the
 * delay's output is. Closing the hand therefore stops new echoes immediately while the ones
 * already travelling die away on their own instead of being cut off. With nothing sent the
 * unit is exactly transparent.
 *
 * Stability: the loop gain is feedback × filters × cross-feed mix. The filters (a one-pole
 * low-pass, and a one-pole high-pass formed as "signal minus its own low-pass") and the mix
 * never exceed unity gain, and the feedback is capped at ECHO_FEEDBACK_CAP, so the loop gain
 * is below 1 at every frequency.
 */
export class EchoUnit implements EffectUnit {
  readonly latencySamples = 0;

  private readonly mask: number = 0;
  private readonly bufferLeft: Float32Array;
  private readonly bufferRight: Float32Array;
  private readonly delayLeft: number = 0;
  private readonly delayRight: number = 0;
  private writeIndex = 0;

  private readonly send: OnePoleSmoother;
  private readonly feedback: OnePoleSmoother;
  private readonly sendRamp = new Float32Array(CHUNK_FRAMES);
  private readonly feedbackRamp = new Float32Array(CHUNK_FRAMES);

  private readonly lowpassCoefficient: number = 0;
  private readonly highpassCoefficient: number = 0;
  /** Feedback filter states per channel: the low-pass, and the low-pass inside the high-pass. */
  private lowpassLeft = 0;
  private lowpassRight = 0;
  private rumbleLeft = 0;
  private rumbleRight = 0;

  constructor(sampleRate: number) {
    this.delayLeft = Math.round(ECHO_DELAY_SEC * (1 - STEREO_OFFSET) * sampleRate);
    this.delayRight = Math.round(ECHO_DELAY_SEC * (1 + STEREO_OFFSET) * sampleRate);
    const size = nextPowerOfTwo(this.delayRight + 1);
    this.mask = size - 1;
    this.bufferLeft = new Float32Array(size);
    this.bufferRight = new Float32Array(size);
    this.send = new OnePoleSmoother(echoWet(0), SMOOTHING_SEC, sampleRate);
    this.feedback = new OnePoleSmoother(echoFeedback(0), SMOOTHING_SEC, sampleRate);
    this.lowpassCoefficient = onePoleCoefficient(FEEDBACK_LOWPASS_HZ, sampleRate);
    this.highpassCoefficient = onePoleCoefficient(FEEDBACK_HIGHPASS_HZ, sampleRate);
  }

  /** Echo intensity, 0..1 (0 = no echo). */
  setIntensity(intensity: number): void {
    if (Number.isNaN(intensity)) return;
    const value = clamp01(intensity);
    this.send.setTarget(echoWet(value));
    this.feedback.setTarget(limitEchoFeedback(echoFeedback(value)));
  }

  process(left: Float32Array, right: Float32Array, frameCount: number): void {
    for (let offset = 0; offset < frameCount; offset += CHUNK_FRAMES) {
      this.processChunk(left, right, offset, Math.min(CHUNK_FRAMES, frameCount - offset));
    }
  }

  reset(): void {
    this.bufferLeft.fill(0);
    this.bufferRight.fill(0);
    this.writeIndex = 0;
    this.lowpassLeft = 0;
    this.lowpassRight = 0;
    this.rumbleLeft = 0;
    this.rumbleRight = 0;
    this.send.snapTo(this.send.targetValue);
    this.feedback.snapTo(this.feedback.targetValue);
  }

  private processChunk(
    left: Float32Array,
    right: Float32Array,
    offset: number,
    count: number,
  ): void {
    const sends = this.sendRamp;
    const feedbacks = this.feedbackRamp;
    this.send.fill(sends, count);
    this.feedback.fill(feedbacks, count);

    const { mask, bufferLeft, bufferRight, delayLeft, delayRight } = this;
    const { lowpassCoefficient, highpassCoefficient } = this;
    let writeIndex = this.writeIndex;
    let lowpassLeft = this.lowpassLeft;
    let lowpassRight = this.lowpassRight;
    let rumbleLeft = this.rumbleLeft;
    let rumbleRight = this.rumbleRight;

    for (let i = 0; i < count; i++) {
      const echoLeft = bufferLeft[(writeIndex - delayLeft) & mask]!;
      const echoRight = bufferRight[(writeIndex - delayRight) & mask]!;

      // What goes round again: low-passed, then high-passed (minus its own low-pass).
      lowpassLeft += lowpassCoefficient * (echoLeft - lowpassLeft);
      lowpassRight += lowpassCoefficient * (echoRight - lowpassRight);
      rumbleLeft += highpassCoefficient * (lowpassLeft - rumbleLeft);
      rumbleRight += highpassCoefficient * (lowpassRight - rumbleRight);
      const returnLeft = lowpassLeft - rumbleLeft;
      const returnRight = lowpassRight - rumbleRight;

      const dryLeft = left[offset + i]!;
      const dryRight = right[offset + i]!;
      const feedback = feedbacks[i]!;
      const feedLeft =
        dryLeft * sends[i]! + feedback * (returnLeft + CROSS_FEED * (returnRight - returnLeft));
      const feedRight =
        dryRight * sends[i]! + feedback * (returnRight + CROSS_FEED * (returnLeft - returnRight));
      // A dying tail must end in true zeros, not in denormal numbers that slow the CPU down.
      bufferLeft[writeIndex] =
        feedLeft > DENORMAL_FLOOR || feedLeft < -DENORMAL_FLOOR ? feedLeft : 0;
      bufferRight[writeIndex] =
        feedRight > DENORMAL_FLOOR || feedRight < -DENORMAL_FLOOR ? feedRight : 0;
      writeIndex = (writeIndex + 1) & mask;

      left[offset + i] = dryLeft + echoLeft;
      right[offset + i] = dryRight + echoRight;
    }

    this.writeIndex = writeIndex;
    this.lowpassLeft = flushDenormal(lowpassLeft);
    this.lowpassRight = flushDenormal(lowpassRight);
    this.rumbleLeft = flushDenormal(rumbleLeft);
    this.rumbleRight = flushDenormal(rumbleRight);
  }
}
