import { describe, expect, it } from 'vitest';
import { StemCapture, type CaptureCommand, type StemCaptureOptions } from './stemCapture';

const RATE = 48000;
const BLOCK = 128;

/**
 * Drives a StemCapture with a signal in which every sample states its own frame number:
 * vocal left = frame, vocal right = frame + 0.5, backing left = -frame, backing right =
 * -(frame + 0.5). Whatever comes out therefore says exactly which frames were captured.
 * (Frame numbers up to 2^23 are exact in a Float32, halves included.)
 */
class Harness {
  readonly chunks: Array<{ vocal: Float32Array; backing: Float32Array }> = [];
  readonly stopped: number[] = [];
  readonly capture: StemCapture;
  private frame = 0;

  constructor(options: Partial<StemCaptureOptions> = {}, startFrame = 0) {
    this.frame = startFrame;
    this.capture = new StemCapture(
      { sampleRate: RATE, fadeSec: 0, ...options },
      {
        onChunk: (vocal, backing) => this.chunks.push({ vocal, backing }),
        onStopped: (frames) => this.stopped.push(frames),
      },
    );
  }

  get position(): number {
    return this.frame;
  }

  schedule(command: CaptureCommand, frame: number): number | null {
    return this.capture.schedule(command, frame);
  }

  /** Renders blocks until the clock reaches `frame` (a multiple of the block size). */
  runTo(frame: number, blockSize = BLOCK): void {
    while (this.frame < frame) {
      const vocalLeft = new Float32Array(blockSize);
      const vocalRight = new Float32Array(blockSize);
      const backingLeft = new Float32Array(blockSize);
      const backingRight = new Float32Array(blockSize);
      for (let n = 0; n < blockSize; n++) {
        vocalLeft[n] = this.frame + n;
        vocalRight[n] = this.frame + n + 0.5;
        backingLeft[n] = -(this.frame + n);
        backingRight[n] = -(this.frame + n + 0.5);
      }
      this.capture.process(this.frame, blockSize, vocalLeft, vocalRight, backingLeft, backingRight);
      this.frame += blockSize;
    }
  }

  /** Frame numbers of everything captured so far, read back from the vocal's left channel. */
  capturedFrames(): number[] {
    return this.chunks.flatMap(({ vocal }) =>
      Array.from({ length: vocal.length / 2 }, (_, n) => vocal[n * 2]!),
    );
  }
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, n) => from + n);
}

describe('StemCapture command timing', () => {
  it('starts and stops on exactly the requested frames, in the middle of blocks', () => {
    const harness = new Harness();
    expect(harness.schedule('start', 1000)).toBe(1000);
    expect(harness.schedule('stop', 5003)).toBe(5003);
    harness.runTo(BLOCK * 50);

    expect(harness.stopped).toEqual([4003]);
    expect(harness.capturedFrames()).toEqual(range(1000, 5003));
    expect(harness.capture.state).toBe('idle');
  });

  it('keeps both stems and both channels in lockstep', () => {
    const harness = new Harness();
    harness.schedule('start', 77);
    harness.schedule('stop', 777);
    harness.runTo(BLOCK * 8);

    const [{ vocal, backing }] = harness.chunks as [{ vocal: Float32Array; backing: Float32Array }];
    expect(vocal.length).toBe(700 * 2);
    expect(backing.length).toBe(vocal.length);
    for (let n = 0; n < 700; n++) {
      expect(vocal[n * 2]).toBe(77 + n);
      expect(vocal[n * 2 + 1]).toBe(77 + n + 0.5);
      expect(backing[n * 2]).toBe(-(77 + n));
      expect(backing[n * 2 + 1]).toBe(-(77 + n + 0.5));
    }
  });

  it('cuts exactly the paused span out of the take', () => {
    const harness = new Harness();
    harness.schedule('start', 300);
    harness.schedule('pause', 1111);
    harness.schedule('resume', 2222);
    harness.schedule('stop', 3333);
    harness.runTo(BLOCK * 30);

    expect(harness.stopped).toEqual([811 + 1111]);
    expect(harness.capturedFrames()).toEqual([...range(300, 1111), ...range(2222, 3333)]);
  });

  it('handles several commands inside one block and on block boundaries', () => {
    const harness = new Harness();
    harness.schedule('start', 128);
    harness.schedule('pause', 130);
    harness.schedule('resume', 140);
    harness.schedule('pause', 256);
    harness.schedule('resume', 384);
    harness.schedule('stop', 385);
    harness.runTo(BLOCK * 4);

    expect(harness.capturedFrames()).toEqual([128, 129, ...range(140, 256), 384]);
    expect(harness.stopped).toEqual([119]);
  });

  it('gives the same result however the stream is cut into blocks', () => {
    const run = (blockSize: number): number[] => {
      const harness = new Harness();
      harness.schedule('start', 500);
      harness.schedule('pause', 9000);
      harness.schedule('resume', 9500);
      harness.schedule('stop', 20_000);
      harness.runTo(20_480, blockSize);
      return harness.capturedFrames();
    };
    expect(run(256)).toEqual(run(128));
    expect(run(64)).toEqual(run(128));
  });

  it('applies a late command on the next frame and reports that frame', () => {
    const harness = new Harness();
    harness.runTo(BLOCK * 10);
    expect(harness.schedule('start', 5)).toBe(1280);
    expect(harness.capture.state).toBe('capturing');
    harness.runTo(BLOCK * 12);
    expect(harness.schedule('stop', 0)).toBe(1536);

    expect(harness.capturedFrames()).toEqual(range(1280, 1536));
    expect(harness.stopped).toEqual([256]);
  });

  it('never lets a later command overtake an earlier one', () => {
    const harness = new Harness();
    expect(harness.schedule('start', 1000)).toBe(1000);
    expect(harness.schedule('pause', 400)).toBe(1000);
    expect(harness.schedule('resume', 1200)).toBe(1200);
    expect(harness.schedule('stop', 1300)).toBe(1300);
    harness.runTo(BLOCK * 11);

    expect(harness.capturedFrames()).toEqual(range(1200, 1300));
  });

  it('starts counting from the audio clock it is given, not from zero', () => {
    const harness = new Harness({}, 1_000_064);
    expect(harness.schedule('start', 1_000_100)).toBe(1_000_100);
    harness.runTo(1_000_064 + BLOCK * 2);
    harness.schedule('stop', 0);
    expect(harness.capturedFrames()).toEqual(range(1_000_100, 1_000_064 + BLOCK * 2));
  });

  it('ignores commands that make no sense in the current state', () => {
    const harness = new Harness();
    harness.schedule('pause', 0);
    harness.schedule('resume', 0);
    expect(harness.capture.state).toBe('idle');

    harness.schedule('start', 0);
    harness.schedule('start', 64);
    harness.schedule('resume', 64);
    harness.runTo(BLOCK);
    harness.schedule('stop', 0);
    expect(harness.capturedFrames()).toEqual(range(0, 128));
  });

  it('answers a stop while idle with zero frames', () => {
    const harness = new Harness();
    harness.schedule('stop', 0);
    expect(harness.stopped).toEqual([0]);
    expect(harness.chunks).toHaveLength(0);
  });

  it('flushes on stop without any further audio, e.g. while the audio clock is halted', () => {
    const harness = new Harness();
    harness.schedule('start', 0);
    harness.runTo(BLOCK * 3);
    harness.schedule('stop', 0);
    expect(harness.stopped).toEqual([384]);
    expect(harness.capturedFrames()).toEqual(range(0, 384));
  });

  it('can stop while paused', () => {
    const harness = new Harness();
    harness.schedule('start', 0);
    harness.schedule('pause', 200);
    harness.runTo(BLOCK * 4);
    harness.schedule('stop', 0);
    expect(harness.stopped).toEqual([200]);
    expect(harness.capturedFrames()).toEqual(range(0, 200));
  });

  it('starts a fresh take after a stop', () => {
    const harness = new Harness();
    harness.schedule('start', 0);
    harness.schedule('stop', 100);
    harness.schedule('start', 300);
    harness.schedule('stop', 350);
    harness.runTo(BLOCK * 4);
    expect(harness.stopped).toEqual([100, 50]);
    expect(harness.capturedFrames()).toEqual([...range(0, 100), ...range(300, 350)]);
  });

  it('refuses commands once its queue is full instead of losing earlier ones', () => {
    const harness = new Harness();
    const results = Array.from({ length: 40 }, (_, n) => harness.schedule('pause', 1000 + n));
    expect(results.filter((frame) => frame === null)).toHaveLength(8);
    expect(results[31]).toBe(1031);
  });
});

describe('StemCapture chunking', () => {
  it('emits quarter-second chunks, then the tail on stop', () => {
    const harness = new Harness();
    harness.schedule('start', 0);
    harness.runTo(BLOCK * 400);
    expect(harness.chunks.map(({ vocal }) => vocal.length / 2)).toEqual([
      12000, 12000, 12000, 12000,
    ]);

    harness.schedule('stop', 0);
    const sizes = harness.chunks.map(({ vocal }) => vocal.length / 2);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(BLOCK * 400);
    expect(harness.stopped).toEqual([BLOCK * 400]);
    for (const { vocal, backing } of harness.chunks) expect(backing.length).toBe(vocal.length);
    expect(harness.capturedFrames()).toEqual(range(0, BLOCK * 400));
  });

  it('holds back one fade length so a pause can still fade what came before it', () => {
    const harness = new Harness({ chunkSec: 0.01, fadeSec: 0.002 });
    harness.schedule('start', 0);
    harness.runTo(BLOCK * 5);
    // 640 frames in; one 480-frame chunk is only released once 480 + 96 frames are buffered.
    expect(harness.chunks.map(({ vocal }) => vocal.length / 2)).toEqual([480]);
    harness.schedule('stop', 0);
    expect(harness.chunks.map(({ vocal }) => vocal.length / 2)).toEqual([480, 160]);
  });

  it('hands out freshly allocated chunks', () => {
    const harness = new Harness({ chunkSec: 0.01 });
    harness.schedule('start', 0);
    harness.runTo(BLOCK * 20);
    const buffers = new Set(
      harness.chunks.flatMap(({ vocal, backing }) => [vocal.buffer, backing.buffer]),
    );
    expect(buffers.size).toBe(harness.chunks.length * 2);
  });

  it('records silence for inputs that are not connected', () => {
    const chunks: Float32Array[] = [];
    const capture = new StemCapture(
      { sampleRate: RATE, fadeSec: 0 },
      { onChunk: (vocal, backing) => chunks.push(vocal, backing), onStopped: () => undefined },
    );
    const mono = new Float32Array(BLOCK).fill(0.25);
    capture.schedule('start', 0);
    capture.process(0, BLOCK, mono, undefined, undefined, undefined);
    capture.schedule('stop', 0);

    const [vocal, backing] = chunks as [Float32Array, Float32Array];
    expect(Array.from(vocal)).toEqual(new Array(BLOCK * 2).fill(0.25));
    expect(Array.from(backing)).toEqual(new Array(BLOCK * 2).fill(0));
  });
});

describe('StemCapture edge fades', () => {
  const FADE_FRAMES = 192;

  /** Captures a constant 1.0 on every channel and returns the vocal's left channel. */
  function captureConstant(
    commands: Array<[CaptureCommand, number]>,
    untilFrame: number,
  ): number[] {
    const left: number[] = [];
    const capture = new StemCapture(
      { sampleRate: RATE },
      {
        onChunk: (vocal, backing) => {
          for (let n = 0; n < vocal.length; n += 2) {
            expect(vocal[n + 1]).toBe(vocal[n]);
            expect(backing[n]).toBe(vocal[n]);
            left.push(vocal[n]!);
          }
        },
        onStopped: () => undefined,
      },
    );
    for (const [command, frame] of commands) capture.schedule(command, frame);
    const ones = new Float32Array(BLOCK).fill(1);
    for (let frame = 0; frame < untilFrame; frame += BLOCK) {
      capture.process(frame, BLOCK, ones, ones, ones, ones);
    }
    return left;
  }

  function largestStep(samples: number[]): number {
    let largest = Math.abs(samples[0]!);
    for (let n = 1; n < samples.length; n++) {
      largest = Math.max(largest, Math.abs(samples[n]! - samples[n - 1]!));
    }
    return Math.max(largest, Math.abs(samples[samples.length - 1]!));
  }

  it('fades in after start and out before stop, leaving the middle untouched', () => {
    const samples = captureConstant(
      [
        ['start', 100],
        ['stop', 20_100],
      ],
      BLOCK * 160,
    );
    expect(samples).toHaveLength(20_000);
    expect(samples[0]).toBeLessThan(0.001);
    expect(samples[FADE_FRAMES - 1]).toBeGreaterThan(0.999);
    for (let n = FADE_FRAMES; n < 20_000 - FADE_FRAMES; n++) expect(samples[n]).toBe(1);
    expect(samples[20_000 - FADE_FRAMES]).toBeGreaterThan(0.999);
    expect(samples[19_999]).toBeLessThan(0.001);
    // 4 ms raised cosine: no step anywhere near a click, including the first and last sample.
    expect(largestStep(samples)).toBeLessThan(0.01);
  });

  it('fades both sides of a pause', () => {
    const samples = captureConstant(
      [
        ['start', 0],
        ['pause', 10_000],
        ['resume', 15_000],
        ['stop', 25_000],
      ],
      BLOCK * 200,
    );
    expect(samples).toHaveLength(20_000);
    expect(samples[9_999]).toBeLessThan(0.001);
    expect(samples[10_000]).toBeLessThan(0.001);
    expect(samples[10_000 - FADE_FRAMES - 1]).toBe(1);
    expect(samples[10_000 + FADE_FRAMES]).toBe(1);
    expect(largestStep(samples)).toBeLessThan(0.01);
  });

  it('fades out a pause that falls right after a chunk was released', () => {
    // 12 000-frame chunks are released at 12 192 buffered frames; pausing a moment later means
    // the fade-out reaches back into frames that were deliberately held back.
    const samples = captureConstant(
      [
        ['start', 0],
        ['pause', 12_200],
        ['stop', 12_300],
      ],
      BLOCK * 100,
    );
    expect(samples).toHaveLength(12_200);
    expect(samples[12_199]).toBeLessThan(0.001);
    expect(samples[12_200 - FADE_FRAMES - 1]).toBe(1);
    expect(largestStep(samples)).toBeLessThan(0.01);
  });

  it('shortens the fades for a segment that is shorter than one fade', () => {
    const samples = captureConstant(
      [
        ['start', 0],
        ['pause', 50],
        ['stop', 60],
      ],
      BLOCK,
    );
    expect(samples).toHaveLength(50);
    expect(samples[0]).toBeLessThan(0.001);
    expect(samples[49]).toBeLessThan(0.001);
    expect(Math.max(...samples)).toBeLessThan(0.2);
  });
});
