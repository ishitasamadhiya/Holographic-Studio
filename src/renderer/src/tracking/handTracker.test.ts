import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawHandFrame } from '@gestures/types';
import type { AppError } from '@shared/errors';
import { HandTracker, WORKER_TIMEOUT_MS } from './handTracker';
import type { TrackerRequest, TrackerResponse } from './protocol';

/** Stands in for the hand-landmarker worker: records what it is sent and answers on demand. */
class FakeWorker {
  static created: FakeWorker[] = [];
  onmessage: ((event: { data: TrackerResponse }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault: () => void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly received: TrackerRequest[] = [];
  terminated = false;

  constructor(
    readonly url: URL,
    readonly options: { type?: string },
  ) {
    FakeWorker.created.push(this);
  }

  postMessage(request: TrackerRequest): void {
    this.received.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  answer(response: TrackerResponse): void {
    this.onmessage?.({ data: response });
  }

  get framesReceived(): number {
    return this.received.filter((request) => request.type === 'frame').length;
  }
}

/** A <video> whose camera frames are delivered by the test. */
class FakeVideo {
  videoWidth = 1280;
  videoHeight = 720;
  private readonly callbacks = new Map<number, (nowMs: number) => void>();
  private nextId = 1;

  requestVideoFrameCallback(callback: (nowMs: number) => void): number {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  }

  cancelVideoFrameCallback(id: number): void {
    this.callbacks.delete(id);
  }

  showFrame(nowMs: number): void {
    const waiting = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of waiting) callback(nowMs);
  }

  get pendingCallbacks(): number {
    return this.callbacks.size;
  }
}

const createImageBitmap = vi.fn(() => Promise.resolve({ close: vi.fn() }));

/** Lets the promise chains started by a camera frame (bitmap creation) run to completion. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
}

function emptyResult(timestampMs: number): TrackerResponse {
  return {
    type: 'result',
    frame: { timestampMs, imageAspect: 16 / 9, hands: [] },
    inferenceMs: 12,
    delegate: 'GPU',
  };
}

function lastWorker(): FakeWorker {
  const worker = FakeWorker.created[FakeWorker.created.length - 1];
  if (!worker) throw new Error('no worker was created');
  return worker;
}

/** Starts a tracker on a fake video and answers the worker's init with 'ready'. */
async function startRunning(
  tracker: HandTracker,
): Promise<{ video: FakeVideo; worker: FakeWorker }> {
  const video = new FakeVideo();
  const started = tracker.start(video as unknown as HTMLVideoElement);
  const worker = lastWorker();
  worker.answer({ type: 'ready', delegate: 'GPU' });
  await started;
  return { video, worker };
}

beforeEach(() => {
  FakeWorker.created = [];
  createImageBitmap.mockClear();
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('window', { location: { href: 'app://studio/tracking-probe.html' } });
  vi.stubGlobal('createImageBitmap', createImageBitmap);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HandTracker', () => {
  it('loads the model in a module worker and runs once the worker is ready', async () => {
    const tracker = new HandTracker();
    const video = new FakeVideo();
    const started = tracker.start(video as unknown as HTMLVideoElement);
    const worker = lastWorker();
    expect(worker.url.href).toContain('handLandmarker.worker');
    expect(worker.options.type).toBe('module');
    expect(worker.received[0]).toEqual({
      type: 'init',
      wasmBaseUrl: 'app://studio/mediapipe/wasm',
      modelUrl: 'app://studio/models/hand_landmarker.task',
      preferredDelegate: 'GPU',
    });
    expect(tracker.running).toBe(false);
    expect(video.pendingCallbacks).toBe(0);

    worker.answer({ type: 'ready', delegate: 'GPU' });
    await started;
    expect(tracker.running).toBe(true);
    expect(tracker.delegate).toBe('GPU');
    expect(video.pendingCallbacks).toBe(1);
  });

  it('sends a downscaled frame and drops camera frames while the worker is busy', async () => {
    const tracker = new HandTracker();
    const frames: RawHandFrame[] = [];
    tracker.onFrame((frame) => frames.push(frame));
    const { video, worker } = await startRunning(tracker);

    video.showFrame(0);
    await settle();
    expect(createImageBitmap).toHaveBeenCalledWith(video, {
      resizeWidth: 640,
      resizeHeight: 360,
      resizeQuality: 'low',
    });
    expect(worker.framesReceived).toBe(1);

    // The worker is still busy: these camera frames are dropped, not queued.
    video.showFrame(40);
    video.showFrame(80);
    await settle();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(worker.framesReceived).toBe(1);

    worker.answer(emptyResult(0));
    expect(frames).toHaveLength(1);
    expect(tracker.inferenceMs).toBe(12);

    video.showFrame(120);
    await settle();
    expect(worker.framesReceived).toBe(2);
  });

  it('takes no more than maxFps frames a second', async () => {
    const tracker = new HandTracker({ maxFps: 10 });
    const { video, worker } = await startRunning(tracker);
    // A 60 fps camera for three seconds, with a worker that answers at once.
    for (let frame = 0; frame < 180; frame += 1) {
      video.showFrame((frame * 1000) / 60);
      await settle();
      const last = worker.received[worker.received.length - 1];
      if (last?.type === 'frame') worker.answer(emptyResult(last.timestampMs));
    }
    expect(worker.framesReceived).toBeGreaterThanOrEqual(30);
    expect(worker.framesReceived).toBeLessThanOrEqual(31);
  });

  it('stops: terminates the worker, stops asking for frames and ignores late answers', async () => {
    const tracker = new HandTracker();
    const frames: RawHandFrame[] = [];
    tracker.onFrame((frame) => frames.push(frame));
    const { video, worker } = await startRunning(tracker);
    video.showFrame(0);
    await settle();
    worker.answer(emptyResult(0));

    tracker.stop();
    expect(worker.terminated).toBe(true);
    expect(video.pendingCallbacks).toBe(0);
    expect(tracker.running).toBe(false);
    expect(tracker.delegate).toBeNull();
    expect(tracker.inferenceMs).toBe(0);
    worker.answer(emptyResult(40));
    expect(frames).toHaveLength(1);
  });

  it('starts again after a stop with a fresh worker', async () => {
    const tracker = new HandTracker();
    const first = await startRunning(tracker);
    tracker.stop();
    const second = await startRunning(tracker);
    expect(second.worker).not.toBe(first.worker);
    expect(tracker.running).toBe(true);
    // Only one worker is alive at any time, even when start is called on a running tracker.
    const third = await startRunning(tracker);
    expect(second.worker.terminated).toBe(true);
    expect(third.worker.terminated).toBe(false);
  });

  it('reports a worker failure once, stops, and still resolves start()', async () => {
    const tracker = new HandTracker();
    const errors: AppError[] = [];
    tracker.onError((error) => errors.push(error));
    const video = new FakeVideo();
    const started = tracker.start(video as unknown as HTMLVideoElement);
    const worker = lastWorker();
    worker.answer({ type: 'failed', detail: 'TypeError: Failed to fetch (model …)' });
    await started;
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('hand-tracking-failed');
    expect(errors[0]?.detail).toContain('Failed to fetch');
    expect(tracker.running).toBe(false);
    expect(worker.terminated).toBe(true);

    worker.answer({ type: 'failed', detail: 'again' });
    expect(errors).toHaveLength(1);
  });

  it('reports a worker that cannot be loaded', async () => {
    const tracker = new HandTracker();
    const errors: AppError[] = [];
    tracker.onError((error) => errors.push(error));
    const started = tracker.start(new FakeVideo() as unknown as HTMLVideoElement);
    const preventDefault = vi.fn();
    lastWorker().onerror?.({ message: 'Failed to load worker script', preventDefault });
    await started;
    expect(preventDefault).toHaveBeenCalled();
    expect(errors.map((error) => error.detail)).toEqual(['Failed to load worker script']);
  });

  it('fails when the worker stops answering frames', async () => {
    vi.useFakeTimers();
    const tracker = new HandTracker();
    const errors: AppError[] = [];
    tracker.onError((error) => errors.push(error));
    const { video, worker } = await startRunning(tracker);
    video.showFrame(0);
    await settle();
    expect(worker.framesReceived).toBe(1);

    vi.advanceTimersByTime(WORKER_TIMEOUT_MS - 1);
    expect(errors).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(errors).toHaveLength(1);
    expect(tracker.running).toBe(false);
    expect(worker.terminated).toBe(true);
  });

  it('does not fail while the worker keeps answering', async () => {
    vi.useFakeTimers();
    const tracker = new HandTracker();
    const errors: AppError[] = [];
    tracker.onError((error) => errors.push(error));
    const { video, worker } = await startRunning(tracker);
    for (let frame = 0; frame < 300; frame += 1) {
      video.showFrame(frame * 40);
      await settle();
      vi.advanceTimersByTime(40);
      const last = worker.received[worker.received.length - 1];
      if (last?.type === 'frame') worker.answer(emptyResult(last.timestampMs));
    }
    expect(errors).toHaveLength(0);
    expect(tracker.running).toBe(true);
  });

  it('keeps calling the other listeners when one throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tracker = new HandTracker();
    const frames: RawHandFrame[] = [];
    const errors: AppError[] = [];
    tracker.onFrame(() => {
      throw new Error('broken frame listener');
    });
    tracker.onFrame((frame) => frames.push(frame));
    tracker.onError(() => {
      throw new Error('broken error listener');
    });
    tracker.onError((error) => errors.push(error));

    const { video, worker } = await startRunning(tracker);
    video.showFrame(0);
    await settle();
    worker.answer(emptyResult(0));
    expect(frames).toHaveLength(1);

    worker.answer({ type: 'failed', detail: 'boom' });
    expect(errors).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it('resolves start() even when an error listener throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tracker = new HandTracker();
    tracker.onError(() => {
      throw new Error('broken error listener');
    });
    const started = tracker.start(new FakeVideo() as unknown as HTMLVideoElement);
    expect(() => lastWorker().answer({ type: 'failed', detail: 'boom' })).not.toThrow();
    await expect(started).resolves.toBeUndefined();
  });

  it('stops delivering to a listener once it unsubscribes', async () => {
    const tracker = new HandTracker();
    const frames: RawHandFrame[] = [];
    const unsubscribe = tracker.onFrame((frame) => frames.push(frame));
    const { video, worker } = await startRunning(tracker);
    unsubscribe();
    video.showFrame(0);
    await settle();
    worker.answer(emptyResult(0));
    expect(frames).toHaveLength(0);
  });
});
