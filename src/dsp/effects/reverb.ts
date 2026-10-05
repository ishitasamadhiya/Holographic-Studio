import type { EffectUnit } from '../effectUnit';
import { OnePoleSmoother } from '../smoothing';

// Freeverb (Jezar at Dreampoint, public domain): eight parallel damped comb filters into four
// series all-pass filters per channel. Delay lengths are the original tunings at 44.1 kHz and
// are scaled to the actual sample rate; the right channel's are slightly longer for width.
const COMB_DELAYS_44K = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_DELAYS_44K = [556, 441, 341, 225];
const STEREO_SPREAD_44K = 23;
const TUNING_RATE_HZ = 44100;

const COMB_COUNT = COMB_DELAYS_44K.length;
const ALLPASS_COUNT = ALLPASS_DELAYS_44K.length;
const LINES_PER_CHANNEL = COMB_COUNT + ALLPASS_COUNT;
const CHANNELS = 2;

/** Comb feedback: sets the decay time (about 1.3 s to -60 dB at this value). */
const ROOM_FEEDBACK = 0.84;
/** High-frequency loss per trip round a comb; keeps the tail warm instead of metallic. */
const DAMPING = 0.25;
const ALLPASS_FEEDBACK = 0.5;
/** Freeverb's input scaling, which keeps eight summed combs at a sane level. */
const INPUT_GAIN = 0.015;
/**
 * Reverb level. Measured with steady noise, the reverb sits about 15 dB under the dry voice
 * at this value: enough to give the voice a room, not enough to wash it out.
 */
const WET_GAIN = 0.28;

/** Fade applied to the reverb's input when it is switched on or off. */
const TOGGLE_FADE_SEC = 0.04;
/**
 * Once nothing has entered the reverb for this long its tail is more than 120 dB down and
 * processing stops. Besides saving CPU this is what keeps the filters out of the denormal
 * range: their state is never left to decay for longer than this.
 */
const TAIL_SEC = 3;

/** Frames processed per pass over the delay lines (bounds the scratch buffers). */
const CHUNK_FRAMES = 128;

/**
 * Light stereo reverb with a click-free on/off switch.
 *
 * Like the echo, the switch fades what is SENT into the reverb: switching on lets the room
 * build up naturally, switching off lets the tail ring out. Once the tail is gone the unit
 * costs nothing. The dry signal always passes through unchanged.
 */
export class ReverbUnit implements EffectUnit {
  readonly latencySamples = 0;

  /** All delay lines back to back: left combs, left all-passes, right combs, right all-passes. */
  private readonly storage: Float32Array;
  private readonly lineStart: Int32Array;
  private readonly lineLength: Int32Array;
  private readonly linePosition: Int32Array;
  private readonly combDamping: Float64Array;
  private readonly sendRamp = new Float32Array(CHUNK_FRAMES);
  private readonly feed = new Float32Array(CHUNK_FRAMES);
  private readonly wet = new Float32Array(CHUNK_FRAMES);

  private readonly send: OnePoleSmoother;
  private readonly tailSamples: number = 0;
  /** Samples since anything other than exact silence was fed in. */
  private silentSamples: number = 0;

  constructor(sampleRate: number) {
    const lineCount = CHANNELS * LINES_PER_CHANNEL;
    this.lineStart = new Int32Array(lineCount);
    this.lineLength = new Int32Array(lineCount);
    this.linePosition = new Int32Array(lineCount);
    this.combDamping = new Float64Array(lineCount);

    const scale = sampleRate / TUNING_RATE_HZ;
    let total = 0;
    for (let channel = 0; channel < CHANNELS; channel++) {
      const spread = channel * STEREO_SPREAD_44K;
      for (let i = 0; i < LINES_PER_CHANNEL; i++) {
        const tuning = i < COMB_COUNT ? COMB_DELAYS_44K[i]! : ALLPASS_DELAYS_44K[i - COMB_COUNT]!;
        const line = channel * LINES_PER_CHANNEL + i;
        this.lineStart[line] = total;
        this.lineLength[line] = Math.max(1, Math.round((tuning + spread) * scale));
        total += this.lineLength[line]!;
      }
    }
    this.storage = new Float32Array(total);

    this.send = new OnePoleSmoother(0, TOGGLE_FADE_SEC, sampleRate);
    this.tailSamples = Math.round(TAIL_SEC * sampleRate);
    this.silentSamples = this.tailSamples;
  }

  setEnabled(enabled: boolean): void {
    this.send.setTarget(enabled ? 1 : 0);
  }

  process(left: Float32Array, right: Float32Array, frameCount: number): void {
    for (let offset = 0; offset < frameCount; offset += CHUNK_FRAMES) {
      this.processChunk(left, right, offset, Math.min(CHUNK_FRAMES, frameCount - offset));
    }
  }

  reset(): void {
    this.storage.fill(0);
    this.linePosition.fill(0);
    this.combDamping.fill(0);
    this.send.snapTo(this.send.targetValue);
    this.silentSamples = this.tailSamples;
  }

  private processChunk(
    left: Float32Array,
    right: Float32Array,
    offset: number,
    count: number,
  ): void {
    const feed = this.feed;
    const sendRamp = this.sendRamp;
    this.send.fill(sendRamp, count);
    const tailSamples = this.tailSamples;
    let silentSamples = this.silentSamples;
    // The filters only run for frames that still have something to say: `runStart` marks
    // the first frame of the current stretch of them. Deciding this per frame (not per
    // chunk) keeps the output independent of how the stream is cut into blocks.
    let runStart = -1;
    for (let i = 0; i < count; i++) {
      const sample = (left[offset + i]! + right[offset + i]!) * INPUT_GAIN * sendRamp[i]!;
      feed[i] = sample;
      if (sample !== 0) silentSamples = 0;
      else if (silentSamples < tailSamples) silentSamples++;
      const ringing = silentSamples < tailSamples;
      if (ringing && runStart < 0) {
        runStart = i;
      } else if (!ringing && runStart >= 0) {
        this.renderRun(left, right, offset, runStart, i);
        runStart = -1;
      }
    }
    this.silentSamples = silentSamples;
    if (runStart >= 0) this.renderRun(left, right, offset, runStart, count);
  }

  /** Adds the reverb for chunk frames `from..to` to the output. */
  private renderRun(
    left: Float32Array,
    right: Float32Array,
    offset: number,
    from: number,
    to: number,
  ): void {
    const wet = this.wet;
    this.renderChannel(0, from, to);
    for (let i = from; i < to; i++) left[offset + i] = left[offset + i]! + WET_GAIN * wet[i]!;
    this.renderChannel(1, from, to);
    for (let i = from; i < to; i++) right[offset + i] = right[offset + i]! + WET_GAIN * wet[i]!;
  }

  /**
   * Runs one channel's filters over `feed[from..to)` into `wet[from..to)`. Each delay line
   * is taken through the whole run in turn, which is equivalent to sample-by-sample
   * processing (the combs are independent and the all-passes form a causal series) but
   * keeps the inner loops tight.
   */
  private renderChannel(channel: number, from: number, to: number): void {
    const storage = this.storage;
    const feed = this.feed;
    const wet = this.wet;
    const firstLine = channel * LINES_PER_CHANNEL;

    wet.fill(0, from, to);
    for (let line = firstLine; line < firstLine + COMB_COUNT; line++) {
      const start = this.lineStart[line]!;
      const length = this.lineLength[line]!;
      let position = this.linePosition[line]!;
      let damped = this.combDamping[line]!;
      for (let i = from; i < to; i++) {
        const delayed = storage[start + position]!;
        // One-pole low-pass inside the comb's feedback: highs decay faster than lows.
        damped = delayed * (1 - DAMPING) + damped * DAMPING;
        storage[start + position] = feed[i]! + damped * ROOM_FEEDBACK;
        wet[i] = wet[i]! + delayed;
        if (++position === length) position = 0;
      }
      this.linePosition[line] = position;
      this.combDamping[line] = damped;
    }
    for (let line = firstLine + COMB_COUNT; line < firstLine + LINES_PER_CHANNEL; line++) {
      const start = this.lineStart[line]!;
      const length = this.lineLength[line]!;
      let position = this.linePosition[line]!;
      for (let i = from; i < to; i++) {
        const delayed = storage[start + position]!;
        const input = wet[i]!;
        storage[start + position] = input + delayed * ALLPASS_FEEDBACK;
        wet[i] = delayed - input;
        if (++position === length) position = 0;
      }
      this.linePosition[line] = position;
    }
  }
}
