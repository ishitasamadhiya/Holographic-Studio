// The camera recorder behind a small interface: MediaRecorder in the app, a fake in tests.
import type { Clock } from './clock';

export interface VideoRecorderOptions {
  mimeType: string;
  videoBitsPerSecond: number;
  /** Receives the recorded bytes, strictly in recording order. */
  onChunk: (chunk: ArrayBuffer) => void;
  /** The recorder failed after it had started (e.g. the encoder gave up). */
  onError: (detail: unknown) => void;
}

export interface VideoRecorder {
  /**
   * Starts recording. Resolves, once the recorder is producing data, with the
   * performance.now() time from which it took frames; rejects when it cannot start.
   */
  start(): Promise<number>;
  pause(): void;
  resume(): void;
  /** Stops (if still recording) and resolves once the last chunk has reached onChunk. */
  stop(): Promise<void>;
}

export interface VideoRecorderFactory {
  isTypeSupported(mimeType: string): boolean;
  /** Records a video-only copy of `stream`, so the recorder never holds the live preview. */
  create(stream: MediaStream, options: VideoRecorderOptions): VideoRecorder;
}

/** The part of MediaRecorder the adapter uses. */
export type MediaRecorderLike = Pick<
  MediaRecorder,
  | 'state'
  | 'start'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'ondataavailable'
  | 'onstart'
  | 'onstop'
  | 'onerror'
>;

export interface MediaRecorderConstructor {
  new (stream: MediaStream, options: MediaRecorderOptions): MediaRecorderLike;
  isTypeSupported(mimeType: string): boolean;
}

export interface VideoRecorderEnvironment {
  Recorder: MediaRecorderConstructor;
  /** A new stream holding clones of the video tracks only. */
  videoOnlyCopy: (stream: MediaStream) => MediaStream;
}

/** How often the recorder hands over data, so a long take is written to disk as it grows. */
const TIMESLICE_MS = 1000;
const START_TIMEOUT_MS = 3000;

function toError(detail: unknown): Error {
  return detail instanceof Error ? detail : new Error(String(detail));
}

function browserEnvironment(): VideoRecorderEnvironment {
  return {
    Recorder: MediaRecorder,
    videoOnlyCopy: (stream) =>
      new MediaStream(stream.getVideoTracks().map((track) => track.clone())),
  };
}

export function createVideoRecorderFactory(
  clock: Clock,
  environment: VideoRecorderEnvironment = browserEnvironment(),
): VideoRecorderFactory {
  const { Recorder, videoOnlyCopy } = environment;

  const create = (stream: MediaStream, options: VideoRecorderOptions): VideoRecorder => {
    const copy = videoOnlyCopy(stream);
    const recorder = new Recorder(copy, {
      mimeType: options.mimeType,
      videoBitsPerSecond: options.videoBitsPerSecond,
    });
    let delivery: Promise<void> = Promise.resolve();
    let rejectStart: ((error: Error) => void) | null = null;
    let startRequested = false;
    let stopping: Promise<void> | null = null;

    let markStopped: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => {
      markStopped = resolve;
    });
    recorder.onstop = () => markStopped();

    recorder.ondataavailable = (event) => {
      const blob = event.data;
      if (blob.size === 0) return;
      // Reading a Blob is asynchronous; chaining the reads keeps the chunks in order.
      delivery = delivery
        .then(async () => options.onChunk(await blob.arrayBuffer()))
        .catch((error: unknown) => options.onError(error));
    };

    recorder.onerror = (event) => {
      const detail = 'error' in event && event.error ? event.error : 'The video recorder failed';
      if (rejectStart) rejectStart(toError(detail));
      else options.onError(detail);
    };

    const start = (): Promise<number> =>
      new Promise<number>((resolve, reject) => {
        const timer = clock.setTimeout(() => {
          rejectStart?.(new Error('The video recorder did not start'));
        }, START_TIMEOUT_MS);
        rejectStart = (error) => {
          clock.clearTimeout(timer);
          rejectStart = null;
          reject(error);
        };

        // MediaRecorder takes frames from the start() call on. Its "start" event only follows
        // once the encoder has produced data (40–220 ms later, measured), so the call — not
        // the event — is the origin of the video's timeline.
        let startedAtMs = 0;
        recorder.onstart = () => {
          clock.clearTimeout(timer);
          rejectStart = null;
          resolve(startedAtMs);
        };
        try {
          startedAtMs = clock.nowMs();
          recorder.start(TIMESLICE_MS);
          startRequested = true;
        } catch (error) {
          rejectStart(toError(error));
        }
      });

    const stop = (): Promise<void> => {
      stopping ??= (async () => {
        rejectStart?.(new Error('The video recorder was stopped before it started'));
        if (recorder.state !== 'inactive') recorder.stop();
        // A recorder whose camera went away stops by itself; its last chunk still arrives
        // before the "stop" event, so that event is awaited either way.
        if (startRequested) await stopped;
        await delivery;
        for (const track of copy.getTracks()) track.stop();
      })();
      return stopping;
    };

    return {
      start,
      pause: () => {
        if (recorder.state === 'recording') recorder.pause();
      },
      resume: () => {
        if (recorder.state === 'paused') recorder.resume();
      },
      stop,
    };
  };

  return {
    isTypeSupported: (mimeType) => Recorder.isTypeSupported(mimeType),
    create,
  };
}
