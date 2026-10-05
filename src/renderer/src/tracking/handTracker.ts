import type { RawHandFrame } from '@gestures/types';
import { createAppError, type AppError } from '@shared/errors';
import { FrameRateLimiter } from './frameRateLimiter';
import type { InferenceDelegate, TrackerRequest, TrackerResponse } from './protocol';

const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/models/hand_landmarker.task';
const DEFAULT_MAX_FPS = 30;
/**
 * A frame the worker has not answered within this long means it has hung (a lost GPU that
 * never returns, for one). Generous, because the first frames include shader warm-up and a
 * switch to the CPU delegate reloads the model.
 */
export const WORKER_TIMEOUT_MS = 5000;

/**
 * Frames are shrunk to this width before inference. The model works on a 224 px hand crop,
 * so more pixels only cost transfer and upload time.
 */
const INFERENCE_WIDTH = 640;

export interface HandTrackerOptions {
  /** Upper bound on inferences per second, a positive number (RangeError otherwise). Default 30. */
  maxFps?: number;
  /** Delegate to try first. Default 'GPU'; CPU is used automatically when GPU cannot be. */
  delegate?: InferenceDelegate;
}

type FrameListener = (frame: RawHandFrame) => void;
type ErrorListener = (error: AppError) => void;

/** Everything belonging to one start()…stop() run, so late events from an old run are ignored. */
interface TrackingSession {
  worker: Worker;
  video: HTMLVideoElement;
  /** True once the model is loaded and frames are being sent. */
  ready: boolean;
  /** True from grabbing a frame until the worker has answered it. */
  busy: boolean;
  frameCallbackId: number | null;
  /** Fails the session if the frame in flight goes unanswered; null when none is. */
  watchdogId: ReturnType<typeof setTimeout> | null;
  /** Resolves the promise returned by start(). */
  settle: () => void;
}

/** Absolute, because MediaPipe imports the WASM glue from inside the worker. */
function assetUrl(path: string): string {
  return new URL(path, window.location.href).href;
}

/**
 * Feeds camera frames to the hand-landmarker worker and hands back raw landmarks.
 * Inference never runs on the UI thread, and a frame that arrives while the worker is still
 * busy is dropped rather than queued, so results are always fresh.
 */
export class HandTracker {
  private readonly limiter: FrameRateLimiter;
  private readonly preferredDelegate: InferenceDelegate;
  private readonly frameListeners = new Set<FrameListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private session: TrackingSession | null = null;
  private latestInferenceMs = 0;
  private activeDelegate: InferenceDelegate | null = null;

  constructor(options: HandTrackerOptions = {}) {
    this.limiter = new FrameRateLimiter(options.maxFps ?? DEFAULT_MAX_FPS);
    this.preferredDelegate = options.delegate ?? 'GPU';
  }

  /** True while the model is loaded and camera frames are being processed. */
  get running(): boolean {
    return this.session?.ready === true;
  }

  /** How long the most recent inference took inside the worker, in milliseconds. */
  get inferenceMs(): number {
    return this.latestInferenceMs;
  }

  /** The delegate in use, or null while not running. */
  get delegate(): InferenceDelegate | null {
    return this.activeDelegate;
  }

  /**
   * Loads the model in a worker and starts processing frames from `video`.
   * Never rejects: the promise resolves once tracking is running or has failed, and a failure
   * is delivered to onError listeners (check `running` afterwards).
   */
  start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    return new Promise<void>((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./handLandmarker.worker.ts', import.meta.url), {
          type: 'module',
        });
      } catch (error) {
        resolve();
        this.emitError(error);
        return;
      }

      const session: TrackingSession = {
        worker,
        video,
        ready: false,
        busy: false,
        frameCallbackId: null,
        watchdogId: null,
        settle: resolve,
      };
      this.session = session;

      worker.onmessage = (event: MessageEvent<TrackerResponse>) => {
        this.handleResponse(session, event.data);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        this.fail(session, event.message || 'The hand-tracking worker could not be loaded');
      };
      worker.onmessageerror = () => {
        this.fail(session, 'A hand-tracking message could not be read');
      };

      this.send(session, {
        type: 'init',
        wasmBaseUrl: assetUrl(WASM_PATH),
        modelUrl: assetUrl(MODEL_PATH),
        preferredDelegate: this.preferredDelegate,
      });
    });
  }

  stop(): void {
    const session = this.session;
    if (!session) return;
    this.endSession(session);
    session.settle();
  }

  /** Subscribes to tracking results. Returns the unsubscribe function. */
  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /** Subscribes to failures (always code 'hand-tracking-failed'). Returns the unsubscribe function. */
  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private send(session: TrackingSession, request: TrackerRequest): void {
    if (request.type !== 'frame') {
      session.worker.postMessage(request);
      return;
    }
    session.worker.postMessage(request, [request.bitmap]);
    session.watchdogId = setTimeout(() => {
      this.fail(session, `The hand-tracking worker did not answer for ${WORKER_TIMEOUT_MS} ms`);
    }, WORKER_TIMEOUT_MS);
  }

  private clearWatchdog(session: TrackingSession): void {
    if (session.watchdogId !== null) clearTimeout(session.watchdogId);
    session.watchdogId = null;
  }

  private handleResponse(session: TrackingSession, response: TrackerResponse): void {
    if (this.session !== session) return;
    switch (response.type) {
      case 'ready':
        session.ready = true;
        this.activeDelegate = response.delegate;
        this.limiter.reset();
        this.requestNextFrame(session);
        session.settle();
        break;
      case 'result':
        this.clearWatchdog(session);
        session.busy = false;
        this.latestInferenceMs = response.inferenceMs;
        this.activeDelegate = response.delegate;
        notify(this.frameListeners, response.frame);
        break;
      case 'failed':
        this.fail(session, response.detail);
        break;
    }
  }

  private requestNextFrame(session: TrackingSession): void {
    session.frameCallbackId = session.video.requestVideoFrameCallback((nowMs) => {
      if (this.session !== session) return;
      this.requestNextFrame(session);
      this.grabFrame(session, nowMs);
    });
  }

  private grabFrame(session: TrackingSession, nowMs: number): void {
    const { videoWidth, videoHeight } = session.video;
    if (session.busy || videoWidth === 0 || videoHeight === 0) return;
    if (!this.limiter.accept(nowMs)) return;

    session.busy = true;
    const scale = Math.min(1, INFERENCE_WIDTH / videoWidth);
    createImageBitmap(session.video, {
      resizeWidth: Math.round(videoWidth * scale),
      resizeHeight: Math.round(videoHeight * scale),
      resizeQuality: 'low',
    }).then(
      (bitmap) => {
        if (this.session !== session) {
          bitmap.close();
          return;
        }
        this.send(session, {
          type: 'frame',
          bitmap,
          timestampMs: nowMs,
          imageAspect: videoWidth / videoHeight,
        });
      },
      () => {
        // The video had no decodable frame at that instant (e.g. the camera is restarting).
        // Skipping it is harmless: the next camera frame is tried as usual.
        session.busy = false;
      },
    );
  }

  private fail(session: TrackingSession, detail: unknown): void {
    if (this.session !== session) return;
    this.endSession(session);
    session.settle();
    this.emitError(detail);
  }

  private endSession(session: TrackingSession): void {
    if (session.frameCallbackId !== null) {
      session.video.cancelVideoFrameCallback(session.frameCallbackId);
    }
    this.clearWatchdog(session);
    session.worker.terminate();
    this.session = null;
    this.activeDelegate = null;
    this.latestInferenceMs = 0;
  }

  private emitError(detail: unknown): void {
    notify(this.errorListeners, createAppError('hand-tracking-failed', detail));
  }
}

/**
 * Calls every listener, even when one of them throws: a broken subscriber must not starve the
 * others or, called from the worker's message handler, stall the tracker.
 */
function notify<T>(listeners: ReadonlySet<(value: T) => void>, value: T): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      console.error('Hand tracking: a listener threw', error);
    }
  }
}
