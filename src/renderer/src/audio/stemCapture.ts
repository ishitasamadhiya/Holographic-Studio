// The stem recorder's logic, kept free of AudioWorklet globals so it can be tested in Node:
// frame-exact start / pause / resume / stop, click-free edges, and chunking.
import { STEM_CHANNELS } from '@shared/take';

export type CaptureCommand = 'start' | 'pause' | 'resume' | 'stop';
export type CaptureState = 'idle' | 'capturing' | 'paused';

/** Length of the chunks handed to the UI thread. */
export const CAPTURE_CHUNK_SEC = 0.25;

/** Fade applied at every capture edge, so a take never starts, pauses or ends with a click. */
export const CAPTURE_FADE_SEC = 0.004;

const COMMAND_QUEUE_CAPACITY = 32;
const COMMANDS: readonly CaptureCommand[] = ['start', 'pause', 'resume', 'stop'];

export interface StemCaptureOptions {
  sampleRate: number;
  chunkSec?: number;
  fadeSec?: number;
}

export interface StemCaptureEvents {
  /**
   * One chunk of both stems, interleaved stereo, always the same length. The arrays are
   * freshly allocated and never touched again, so their buffers may be transferred.
   */
  onChunk(vocal: Float32Array<ArrayBuffer>, backing: Float32Array<ArrayBuffer>): void;
  /** Capture has ended and every captured frame has been handed to `onChunk`. */
  onStopped(frames: number): void;
}

/** Gain of step `position` (0-based) of a `length`-step raised-cosine fade-in. Never exactly 0 or 1. */
function fadeGain(position: number, length: number): number {
  return 0.5 - 0.5 * Math.cos((Math.PI * (position + 1)) / (length + 1));
}

/**
 * Captures two stereo streams in lockstep.
 *
 * Commands carry an absolute frame number and take effect on exactly that frame, even in the
 * middle of a block. A command for a frame that has already gone by takes effect on the next
 * frame instead, and `schedule` reports the frame that was really used.
 *
 * Edges are faded: a fade-in over the first frames after start/resume, and a fade-out over
 * the last frames before pause/stop. The fade-out is applied after the fact to frames that
 * are still buffered (the buffer always retains at least one fade length), which is what
 * lets a pause land on its exact frame without knowing about it in advance.
 */
export class StemCapture {
  private readonly events: StemCaptureEvents;
  private readonly chunkFrames: number;
  private readonly fadeFrames: number;
  private readonly capacityFrames: number;
  private readonly vocal: Float32Array;
  private readonly backing: Float32Array;
  private readonly fadeIn: Float32Array;

  private readonly queuedCommands = new Uint8Array(COMMAND_QUEUE_CAPACITY);
  private readonly queuedFrames = new Float64Array(COMMAND_QUEUE_CAPACITY);
  private queueHead = 0;
  private queueLength = 0;
  /** Frame of the most recently queued command: later commands never jump ahead of it. */
  private lastQueuedFrame = 0;

  private currentState: CaptureState = 'idle';
  /** First frame that has not been processed yet. */
  private nextFrame = 0;
  private bufferedFrames = 0;
  /** Frames captured since the last start or resume. */
  private segmentFrames = 0;
  private totalFrames = 0;

  constructor(options: StemCaptureOptions, events: StemCaptureEvents) {
    const { sampleRate } = options;
    this.events = events;
    this.chunkFrames = Math.max(
      1,
      Math.round((options.chunkSec ?? CAPTURE_CHUNK_SEC) * sampleRate),
    );
    this.fadeFrames = Math.max(0, Math.round((options.fadeSec ?? CAPTURE_FADE_SEC) * sampleRate));
    this.capacityFrames = this.chunkFrames + this.fadeFrames;
    this.vocal = new Float32Array(this.capacityFrames * STEM_CHANNELS);
    this.backing = new Float32Array(this.capacityFrames * STEM_CHANNELS);
    this.fadeIn = new Float32Array(this.fadeFrames);
    for (let n = 0; n < this.fadeFrames; n++) this.fadeIn[n] = fadeGain(n, this.fadeFrames);
  }

  get state(): CaptureState {
    return this.currentState;
  }

  /**
   * Queues a command and returns the frame it will take effect on: the requested frame, or
   * the earliest frame still possible. Returns null when too many commands are waiting.
   */
  schedule(command: CaptureCommand, frame: number): number | null {
    if (this.queueLength === COMMAND_QUEUE_CAPACITY) return null;
    const requested = Number.isFinite(frame) ? Math.round(frame) : 0;
    const earliest = this.queueLength > 0 ? this.lastQueuedFrame : this.nextFrame;
    const effective = Math.max(requested, earliest, this.nextFrame);

    const slot = (this.queueHead + this.queueLength) % COMMAND_QUEUE_CAPACITY;
    this.queuedCommands[slot] = COMMANDS.indexOf(command);
    this.queuedFrames[slot] = effective;
    this.queueLength++;
    this.lastQueuedFrame = effective;

    // An edge at the very next frame needs no more audio, so it happens right away. That is
    // what lets stop flush the tail even when the audio clock is not advancing.
    this.applyCommandsDueAt(this.nextFrame);
    return effective;
  }

  /**
   * Feeds one render block whose first sample is frame `blockFrame`. A missing channel is
   * silence; a missing right channel repeats the left one.
   */
  process(
    blockFrame: number,
    frameCount: number,
    vocalLeft: Float32Array | undefined,
    vocalRight: Float32Array | undefined,
    backingLeft: Float32Array | undefined,
    backingRight: Float32Array | undefined,
  ): void {
    let offset = 0;
    for (;;) {
      this.applyCommandsDueAt(blockFrame + offset);
      if (offset >= frameCount) break;

      let end = frameCount;
      if (this.queueLength > 0) {
        end = Math.min(frameCount, this.queuedFrames[this.queueHead]! - blockFrame);
      }
      if (this.currentState === 'capturing') {
        this.append(offset, end, vocalLeft, vocalRight, backingLeft, backingRight);
      }
      offset = end;
    }
    this.nextFrame = blockFrame + frameCount;
  }

  private applyCommandsDueAt(frame: number): void {
    while (this.queueLength > 0 && this.queuedFrames[this.queueHead]! <= frame) {
      const command = COMMANDS[this.queuedCommands[this.queueHead]!]!;
      this.queueHead = (this.queueHead + 1) % COMMAND_QUEUE_CAPACITY;
      this.queueLength--;
      this.apply(command);
    }
  }

  private apply(command: CaptureCommand): void {
    switch (command) {
      case 'start':
        if (this.currentState !== 'idle') return;
        this.currentState = 'capturing';
        this.bufferedFrames = 0;
        this.segmentFrames = 0;
        this.totalFrames = 0;
        return;
      case 'pause':
        if (this.currentState !== 'capturing') return;
        this.fadeOutTail();
        this.currentState = 'paused';
        return;
      case 'resume':
        if (this.currentState !== 'paused') return;
        this.currentState = 'capturing';
        this.segmentFrames = 0;
        return;
      case 'stop':
        if (this.currentState === 'capturing') this.fadeOutTail();
        if (this.currentState !== 'idle' && this.bufferedFrames > 0) this.emit(this.bufferedFrames);
        this.events.onStopped(this.currentState === 'idle' ? 0 : this.totalFrames);
        this.currentState = 'idle';
        return;
    }
  }

  private append(
    from: number,
    to: number,
    vocalLeft: Float32Array | undefined,
    vocalRight: Float32Array | undefined,
    backingLeft: Float32Array | undefined,
    backingRight: Float32Array | undefined,
  ): void {
    let position = from;
    while (position < to) {
      const frames = Math.min(to - position, this.capacityFrames - this.bufferedFrames);
      this.interleave(this.vocal, vocalLeft, vocalRight, position, frames);
      this.interleave(this.backing, backingLeft, backingRight, position, frames);
      if (this.segmentFrames < this.fadeFrames) this.fadeInHead(frames);

      position += frames;
      this.bufferedFrames += frames;
      this.segmentFrames += frames;
      this.totalFrames += frames;
      if (this.bufferedFrames === this.capacityFrames) this.emit(this.chunkFrames);
    }
  }

  private interleave(
    target: Float32Array,
    left: Float32Array | undefined,
    right: Float32Array | undefined,
    from: number,
    frames: number,
  ): void {
    const start = this.bufferedFrames * STEM_CHANNELS;
    if (left === undefined) {
      target.fill(0, start, start + frames * STEM_CHANNELS);
      return;
    }
    const rightOrLeft = right ?? left;
    for (let n = 0; n < frames; n++) {
      target[start + n * STEM_CHANNELS] = left[from + n]!;
      target[start + n * STEM_CHANNELS + 1] = rightOrLeft[from + n]!;
    }
  }

  /** Applies the fade-in to the `frames` frames just written, as far as it still reaches. */
  private fadeInHead(frames: number): void {
    const faded = Math.min(frames, this.fadeFrames - this.segmentFrames);
    for (let n = 0; n < faded; n++) {
      this.scaleFrame(this.bufferedFrames + n, this.fadeIn[this.segmentFrames + n]!);
    }
  }

  /** Fades out the end of what has been captured since the last start or resume. */
  private fadeOutTail(): void {
    const length = Math.min(this.fadeFrames, this.segmentFrames, this.bufferedFrames);
    const first = this.bufferedFrames - length;
    for (let n = 0; n < length; n++) this.scaleFrame(first + n, fadeGain(length - 1 - n, length));
  }

  private scaleFrame(frame: number, gain: number): void {
    const index = frame * STEM_CHANNELS;
    for (let channel = 0; channel < STEM_CHANNELS; channel++) {
      this.vocal[index + channel] = this.vocal[index + channel]! * gain;
      this.backing[index + channel] = this.backing[index + channel]! * gain;
    }
  }

  /**
   * Hands the oldest `frames` buffered frames to the listener and keeps the rest. The two
   * chunk arrays are the audio thread's one steady allocation (two per chunk, four chunks a
   * second): they are transferred rather than copied, and whoever receives them may keep them.
   */
  private emit(frames: number): void {
    const samples = frames * STEM_CHANNELS;
    const buffered = this.bufferedFrames * STEM_CHANNELS;
    const vocalChunk = new Float32Array(samples);
    const backingChunk = new Float32Array(samples);
    vocalChunk.set(this.vocal.subarray(0, samples));
    backingChunk.set(this.backing.subarray(0, samples));
    this.vocal.copyWithin(0, samples, buffered);
    this.backing.copyWithin(0, samples, buffered);
    this.bufferedFrames -= frames;
    this.events.onChunk(vocalChunk, backingChunk);
  }
}
