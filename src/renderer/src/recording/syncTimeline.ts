// The clock arithmetic that lines up vocal, backing track, and video in an exported take.
// Everything here is pure; see TakeManifest in src/shared/take.ts for the model it feeds.

/**
 * One reading of AudioContext.getOutputTimestamp(): the audio sample at `contextTimeSec`
 * reaches the listener's ears at `performanceTimeMs` (on the performance.now() clock).
 */
export interface OutputTimestampSample {
  contextTimeSec: number;
  performanceTimeMs: number;
}

/** Used until real camera timing has been observed. Typical for built-in and USB webcams. */
export const DEFAULT_CAMERA_LATENCY_MS = 60;

/** Camera latencies outside this range are measurement glitches, not real hardware. */
const MAX_PLAUSIBLE_CAMERA_LATENCY_MS = 500;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

/**
 * Maps the audio clock onto the performance.now() clock.
 *
 * Single readings jitter by a few milliseconds (they are taken on the UI thread while the
 * audio thread keeps running), so the mapping uses the median offset of recent readings.
 */
export class OutputClock {
  private readonly offsetsMs: number[] = [];

  constructor(private readonly capacity = 31) {}

  /** Returns false when the reading is unusable (Chromium reports zeros until audio flows). */
  addSample(sample: OutputTimestampSample): boolean {
    const { contextTimeSec, performanceTimeMs } = sample;
    if (!(contextTimeSec > 0) || !(performanceTimeMs > 0)) return false;
    if (!Number.isFinite(contextTimeSec) || !Number.isFinite(performanceTimeMs)) return false;
    this.offsetsMs.push(performanceTimeMs - contextTimeSec * 1000);
    if (this.offsetsMs.length > this.capacity) this.offsetsMs.shift();
    return true;
  }

  get isReady(): boolean {
    return this.offsetsMs.length > 0;
  }

  reset(): void {
    this.offsetsMs.length = 0;
  }

  /** performance.now() time at which the audio rendered at `contextTimeSec` is heard. */
  heardAtMs(contextTimeSec: number): number {
    if (!this.isReady) throw new Error('OutputClock has no samples yet');
    return contextTimeSec * 1000 + median(this.offsetsMs);
  }

  /** The audio-clock time whose sound is heard at the given performance.now() time. */
  contextTimeHeardAt(performanceTimeMs: number): number {
    if (!this.isReady) throw new Error('OutputClock has no samples yet');
    return (performanceTimeMs - median(this.offsetsMs)) / 1000;
  }
}

/**
 * Fallback for platforms where getOutputTimestamp() never reports usable values: derive one
 * equivalent reading from the context's current time and its reported output latency.
 */
export function outputTimestampFromLatency(
  currentContextTimeSec: number,
  nowPerformanceMs: number,
  outputLatencySec: number,
): OutputTimestampSample {
  return {
    contextTimeSec: currentContextTimeSec,
    performanceTimeMs: nowPerformanceMs + outputLatencySec * 1000,
  };
}

export interface LatencyBreakdown {
  /** Microphone capture → audio graph. */
  inputSec: number;
  /** Audio graph → the singer's ears. */
  outputSec: number;
  /** Delay added by the vocal effects chain. */
  processingSec: number;
}

/**
 * How late the recorded vocal is relative to the backing track the singer was hearing.
 *
 * The singer performs to what they HEAR, which left the graph `outputSec` earlier; their voice
 * then needs `inputSec + processingSec` to arrive at the recorder. The exporter moves the
 * vocal earlier by this total. `userOffsetMs` is the fine-tune from Settings: a positive
 * value places the vocal later in the export, i.e. compensates less.
 */
export function computeVocalLatencySec(latency: LatencyBreakdown, userOffsetMs: number): number {
  return latency.inputSec + latency.outputSec + latency.processingSec - userOffsetMs / 1000;
}

/** Delay the singer perceives between singing and hearing themself. */
export function computeMonitoringLatencySec(latency: LatencyBreakdown): number {
  return latency.inputSec + latency.processingSec + latency.outputSec;
}

/**
 * Tracks how long a camera frame takes to travel from the sensor to the app, from the
 * per-frame metadata of requestVideoFrameCallback. Without readings it reports a typical value.
 */
export class CameraLatencyEstimator {
  private readonly readingsMs: number[] = [];

  constructor(private readonly capacity = 45) {}

  /**
   * @param captureTimeMs when the sensor captured the frame (performance.now() clock)
   * @param arrivalTimeMs when the frame became available to the app (same clock)
   */
  addFrame(captureTimeMs: number | undefined, arrivalTimeMs: number): void {
    if (captureTimeMs === undefined || !Number.isFinite(captureTimeMs)) return;
    const latency = arrivalTimeMs - captureTimeMs;
    if (!(latency >= 0) || latency > MAX_PLAUSIBLE_CAMERA_LATENCY_MS) return;
    this.readingsMs.push(latency);
    if (this.readingsMs.length > this.capacity) this.readingsMs.shift();
  }

  get hasMeasurement(): boolean {
    return this.readingsMs.length >= 5;
  }

  get latencyMs(): number {
    return this.hasMeasurement ? median(this.readingsMs) : DEFAULT_CAMERA_LATENCY_MS;
  }

  reset(): void {
    this.readingsMs.length = 0;
  }
}

/**
 * When the first recorded video frame was captured by the camera.
 *
 * MediaRecorder's timeline starts at the first frame DELIVERED to it after it starts. Frames
 * arrive one frame interval apart, so on average that delivery happens half an interval after
 * the recorder started, and the frame itself was captured one camera latency before that.
 */
export function estimateFirstFrameCaptureMs(options: {
  recorderStartedMs: number;
  frameIntervalMs: number;
  cameraLatencyMs: number;
}): number {
  return options.recorderStartedMs + options.frameIntervalMs / 2 - options.cameraLatencyMs;
}

/**
 * TakeManifest.video.startOffsetSec: when the first video frame was captured, measured from
 * the moment the first captured audio frame was HEARD (W0 in the manifest's clock model).
 * `userOffsetMs` is the fine-tune from Settings: a positive value makes the picture later
 * relative to the sound.
 */
export function computeVideoStartOffsetSec(options: {
  firstFrameCaptureMs: number;
  captureStartContextSec: number;
  clock: OutputClock;
  userOffsetMs: number;
}): number {
  const audioStartHeardMs = options.clock.heardAtMs(options.captureStartContextSec);
  return (options.firstFrameCaptureMs - audioStartHeardMs + options.userOffsetMs) / 1000;
}

/** Adds up recording time across pauses, on any monotonic millisecond clock. */
export class ElapsedTimer {
  private accumulatedMs = 0;
  private runningSinceMs: number | null = null;

  start(nowMs: number): void {
    this.accumulatedMs = 0;
    this.runningSinceMs = nowMs;
  }

  pause(nowMs: number): void {
    if (this.runningSinceMs === null) return;
    this.accumulatedMs += nowMs - this.runningSinceMs;
    this.runningSinceMs = null;
  }

  resume(nowMs: number): void {
    if (this.runningSinceMs === null) this.runningSinceMs = nowMs;
  }

  get isRunning(): boolean {
    return this.runningSinceMs !== null;
  }

  elapsedMs(nowMs: number): number {
    const running = this.runningSinceMs === null ? 0 : nowMs - this.runningSinceMs;
    return this.accumulatedMs + running;
  }
}
