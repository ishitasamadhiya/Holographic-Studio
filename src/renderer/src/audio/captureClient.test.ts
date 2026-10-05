import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAppError } from '@shared/errors';
import type { TakeAudioChunk } from '@shared/take';
import { CaptureClient, type RecorderPort } from './captureClient';
import type { RecorderEvent, RecorderRequest } from './protocol';
import { StemCapture } from './stemCapture';

const RATE = 48000;
const BLOCK = 128;

/**
 * The stem-recorder worklet without the audio thread: the same StemCapture behind the same
 * message protocol, with replies delivered asynchronously like a real MessagePort.
 */
class FakeRecorder implements RecorderPort {
  onmessage: ((event: MessageEvent<RecorderEvent>) => void) | null = null;
  readonly requests: RecorderRequest[] = [];
  /** When false the recorder has "died": requests are swallowed. */
  alive = true;
  private frame = 0;
  private readonly capture = new StemCapture(
    { sampleRate: RATE, fadeSec: 0 },
    {
      onChunk: (vocal, backing) =>
        this.reply({ type: 'chunk', vocal: vocal.buffer, backing: backing.buffer }),
      onStopped: (frames) => this.reply({ type: 'stopped', frames }),
    },
  );

  postMessage(request: RecorderRequest): void {
    this.requests.push(request);
    if (!this.alive) return;
    const frame = this.capture.schedule(request.command, request.frame);
    this.reply({ type: 'scheduled', id: request.id, frame });
  }

  /** Renders audio up to `frame`; every vocal sample is its own frame number. */
  runTo(frame: number): void {
    while (this.frame < frame) {
      const vocal = Float32Array.from({ length: BLOCK }, (_, n) => this.frame + n);
      this.capture.process(this.frame, BLOCK, vocal, vocal, undefined, undefined);
      this.frame += BLOCK;
    }
  }

  private reply(event: RecorderEvent): void {
    queueMicrotask(() => this.onmessage?.({ data: event } as MessageEvent<RecorderEvent>));
  }
}

function setup() {
  const recorder = new FakeRecorder();
  const chunks: TakeAudioChunk[] = [];
  const client = new CaptureClient(recorder, RATE, (chunk) => chunks.push(chunk));
  const deliveredFrames = (): number =>
    chunks.reduce((sum, chunk) => sum + chunk.vocal.byteLength / 8, 0);
  return { recorder, chunks, client, deliveredFrames };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CaptureClient', () => {
  it('reports the audio-clock time of the first captured frame', async () => {
    const { recorder, client } = setup();
    recorder.runTo(BLOCK * 10);
    const started = await client.start(4800);
    expect(started.startContextTimeSec).toBe(0.1);
    expect(client.isActive).toBe(true);
  });

  it('reports the real start when the requested frame has already gone by', async () => {
    const { recorder, client } = setup();
    recorder.runTo(BLOCK * 100);
    const started = await client.start(4800);
    expect(started.startContextTimeSec).toBe((BLOCK * 100) / RATE);
  });

  it('delivers every chunk before stop resolves, and reports the exact frame count', async () => {
    const { recorder, client, chunks, deliveredFrames } = setup();
    await client.start(1000);
    recorder.runTo(BLOCK * 300);
    const delivered: number[] = [];
    const finished = await client.stop().then((result) => {
      delivered.push(deliveredFrames());
      return result;
    });

    expect(finished.frames).toBe(BLOCK * 300 - 1000);
    expect(delivered).toEqual([finished.frames]);
    for (const chunk of chunks) expect(chunk.backing.byteLength).toBe(chunk.vocal.byteLength);
    expect(new Float32Array(chunks[0]!.vocal)[0]).toBe(1000);
    expect(client.isActive).toBe(false);
  });

  it('cuts a paused span out of the take', async () => {
    const { recorder, client } = setup();
    await client.start(0);
    await client.pause(10_000);
    await client.resume(14_000);
    recorder.runTo(BLOCK * 200);
    expect((await client.stop()).frames).toBe(BLOCK * 200 - 4000);
  });

  it('ignores pause and resume that do not fit the current state', async () => {
    const { recorder, client } = setup();
    await client.pause(0);
    await client.resume(0);
    expect(recorder.requests).toHaveLength(0);

    await client.start(0);
    await client.resume(100);
    await client.pause(200);
    await client.pause(300);
    expect(recorder.requests.map((request) => request.command)).toEqual(['start', 'pause']);
  });

  it('rejects a second start with a friendly error and leaves the first take alone', async () => {
    const { recorder, client } = setup();
    await client.start(0);
    const failure = await client.start(0).catch((error: unknown) => error);
    expect(isAppError(failure) && failure.code).toBe('recording-failed');

    recorder.runTo(BLOCK * 10);
    expect((await client.stop()).frames).toBe(BLOCK * 10);
  });

  it('answers stop with zero frames when nothing was started', async () => {
    const { recorder, client } = setup();
    expect(await client.stop()).toEqual({ frames: 0 });
    expect(recorder.requests).toHaveLength(0);
  });

  it('gives concurrent stop calls the same answer', async () => {
    const { recorder, client } = setup();
    await client.start(0);
    recorder.runTo(BLOCK * 5);
    const [first, second] = await Promise.all([client.stop(), client.stop()]);
    expect(first).toEqual({ frames: BLOCK * 5 });
    expect(second).toEqual(first);
    expect(recorder.requests.filter((request) => request.command === 'stop')).toHaveLength(1);
  });

  it('can record a second take after the first', async () => {
    const { recorder, client } = setup();
    await client.start(0);
    recorder.runTo(BLOCK * 4);
    await client.stop();

    await client.start(BLOCK * 6);
    recorder.runTo(BLOCK * 9);
    expect((await client.stop()).frames).toBe(BLOCK * 3);
  });

  it('ends the take with what arrived when the recorder never confirms the stop', async () => {
    vi.useFakeTimers();
    const { recorder, client, deliveredFrames } = setup();
    const starting = client.start(0);
    await vi.advanceTimersByTimeAsync(0);
    await starting;
    recorder.runTo(BLOCK * 200);
    await vi.advanceTimersByTimeAsync(0);
    expect(deliveredFrames()).toBe(24_000);

    recorder.alive = false;
    const stopping = client.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await stopping).toEqual({ frames: 24_000 });
    expect(client.isActive).toBe(false);
  });

  it('settles everything that is still waiting when it is disposed', async () => {
    const { recorder, client } = setup();
    await client.start(0);
    recorder.alive = false;
    const pausing = client.pause(100);
    const stopping = client.stop();
    client.dispose();

    await expect(pausing).resolves.toBeUndefined();
    await expect(stopping).resolves.toEqual({ frames: 0 });
    expect(recorder.onmessage).toBeNull();
  });

  it('fails the start when the recorder goes away before confirming it', async () => {
    const { recorder, client } = setup();
    recorder.alive = false;
    const starting = client.start(0).catch((error: unknown) => error);
    client.dispose();
    const failure = await starting;
    expect(isAppError(failure) && failure.code).toBe('recording-failed');
    expect(client.isActive).toBe(false);
  });
});
