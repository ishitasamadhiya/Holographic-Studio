// The recording state machine: countdown → recording ↔ paused → finishing → review →
// exporting → saved. It drives the audio engine's capture, the camera recorder and the
// main-process take storage, and keeps their three timelines describable by one manifest.
import type { AudioEngine } from '@renderer/audio/engineTypes';
import type { Notice, RecordingState } from '@renderer/state/studioTypes';
import { clamp01 } from '@shared/controls';
import { createAppError, isAppError, type AppError } from '@shared/errors';
import type { HoloApi, Unsubscribe } from '@shared/ipc';
import type { RecordingMode, Settings } from '@shared/settings';
import {
  defaultTakeFileName,
  STEM_BYTES_PER_FRAME,
  type TakeInit,
  type TakeManifest,
} from '@shared/take';
import { sleep, withTimeout, type Clock } from './clock';
import { pickRecorderMimeType, recorderBitsPerSecond } from './recorderMimeType';
import {
  ElapsedTimer,
  OutputClock,
  outputTimestampFromLatency,
  type LatencyBreakdown,
} from './syncTimeline';
import type { TakeArtworkRenderer } from './takeArtwork';
import { buildTakeManifest } from './takeManifestBuilder';
import type { VideoRecorder, VideoRecorderFactory } from './videoRecorder';

/**
 * How far ahead of "now" capture is scheduled on the audio clock. The request travels to the
 * audio thread as a message; this is comfortably longer than that takes, so the start lands
 * on the exact frame that was asked for.
 */
export const CAPTURE_LEAD_SEC = 0.08;
/** The backing track starts this long into the capture, so its first sample is on record. */
export const BACKING_LEAD_SEC = 0.1;
/** Pause and resume are scheduled this far ahead on the audio clock. */
export const TRANSITION_LEAD_SEC = 0.05;
/** Two scheduled transitions are kept at least this far apart, however fast the user clicks. */
const MIN_TRANSITION_GAP_SEC = 0.02;
/** Recording continues this long after the backing track ends, for echo and reverb tails. */
export const BACKING_TAIL_MS = 1500;
/** Shorter takes are slips of the finger, not performances; they are dropped without fuss. */
export const MIN_TAKE_SEC = 0.5;
/** Longest wait for a device to confirm a stop before the take is finished without it. */
const DEVICE_TIMEOUT_MS = 5000;
/** Longest wait for the picture's pause moment (covers even Bluetooth output latency). */
const MAX_VIDEO_TRANSITION_WAIT_MS = 1000;

/** The running camera, as the recorder needs it. */
export interface CameraFeed {
  stream: MediaStream;
  width: number;
  height: number;
  frameRate: number;
  /** Sensor-to-app delay in milliseconds (measured, or a typical value until it is). */
  latencyMs: number;
}

export interface RecordingControllerOptions {
  api: Pick<HoloApi, 'take' | 'exporter'>;
  engine: AudioEngine;
  clock: Clock;
  videoRecorders: VideoRecorderFactory;
  renderTakeArtwork: TakeArtworkRenderer;
  /** Wall-clock date, for the suggested file name and the artwork. */
  now: () => Date;
  getSettings: () => Settings;
  /** The running camera, or null when it is off. */
  getCameraFeed: () => CameraFeed | null;
  /** Why the camera is not running, when there is a known reason. */
  getCameraError: () => AppError | null;
  getBackingTrackName: () => string | null;
  getState: () => RecordingState;
  setState: (patch: Partial<RecordingState>) => void;
  notify: (kind: Notice['kind'], message: string) => void;
  /** Called when a take is about to start (the backing-track audition must stop). */
  onTakeStarting: () => void;
}

interface VideoCapture {
  recorder: VideoRecorder;
  /** performance.now() time from which the recorder took frames. */
  startedMs: number;
  /** Time the recorder has spent taking frames (it stands still while paused). */
  activeTimer: ElapsedTimer;
  width: number;
  height: number;
  frameRate: number;
  cameraLatencyMs: number;
}

interface ActiveTake {
  takeId: string;
  mode: RecordingMode;
  sampleRate: number;
  hasBacking: boolean;
  backingTrackName: string | null;
  video: VideoCapture | null;
  captureRequested: boolean;
  captureStopped: boolean;
  captureStartContextSec: number;
  pauses: number;
  /** Where the backing track was stopped by a pause; null when it was not playing. */
  pausedSongPositionSec: number | null;
  backingEnded: boolean;
  framesForwarded: number;
  stopForwarding: Unsubscribe;
}

interface FinishedTake {
  takeId: string;
  mode: RecordingMode;
  backingTrackName: string | null;
}

const START_CANCELLED = Symbol('start cancelled');

const IDLE_STATE: Partial<RecordingState> = {
  status: 'idle',
  countdownRemaining: 0,
  takeDurationSec: 0,
  exportStage: null,
  exportProgress: 0,
  savedPath: null,
};

export class RecordingController {
  private take: ActiveTake | null = null;
  private finished: FinishedTake | null = null;
  private starting: Promise<void> | null = null;
  private startCancelled = false;
  private cancelCountdown: (() => void) | null = null;
  /** Pause/resume work in flight; never rejects. */
  private transitions: Promise<void> = Promise.resolve();
  /** Clean-up of an abandoned take; the next take waits for it. Never rejects. */
  private settling: Promise<void> = Promise.resolve();
  private lastTransitionContextSec = 0;
  private tailTimer: number | null = null;
  private saving = false;
  private readonly elapsed = new ElapsedTimer();
  private readonly unsubscribeBackingEnded: Unsubscribe;

  constructor(private readonly options: RecordingControllerOptions) {
    this.unsubscribeBackingEnded = options.engine.onBackingEnded(() => this.handleBackingEnded());
  }

  /** True from the first countdown tick until the take is finished or abandoned. */
  get isTakeInProgress(): boolean {
    if (this.starting) return true;
    const { status } = this.options.getState();
    return (
      status === 'countdown' ||
      status === 'recording' ||
      status === 'paused' ||
      status === 'finishing'
    );
  }

  /** Recording time so far in seconds, pauses excluded; 0 when no take is running. */
  elapsedSec(nowMs: number): number {
    return this.take ? this.elapsed.elapsedMs(nowMs) / 1000 : 0;
  }

  /** idle → countdown (when enabled) → recording. Ignored in any other state. */
  start(): Promise<void> {
    const { getSettings, getState, notify, setState } = this.options;
    if (this.starting || getState().status !== 'idle') return Promise.resolve();
    const audioProblem = this.audioProblem();
    if (audioProblem) {
      notify('warning', audioProblem.message);
      return Promise.resolve();
    }
    if (getSettings().mode === 'video') {
      const blocker = this.videoBlocker();
      if (blocker) {
        setState({ error: blocker });
        notify('error', blocker.message);
        return Promise.resolve();
      }
    }

    this.startCancelled = false;
    this.starting = this.runStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** recording ↔ paused. Ignored in any other state. */
  togglePause(): void {
    const { clock, getState, setState } = this.options;
    const take = this.take;
    if (!take) return;
    const { status } = getState();
    if (status === 'recording') {
      setState({ status: 'paused' });
      this.elapsed.pause(clock.nowMs());
      this.clearTailTimer();
      this.enqueueTransition(take, () => this.pauseTake(take));
    } else if (status === 'paused') {
      setState({ status: 'recording' });
      this.elapsed.resume(clock.nowMs());
      this.enqueueTransition(take, () => this.resumeTake(take));
    }
  }

  /** recording/paused → finishing → review. Ignored in any other state. */
  async stop(): Promise<void> {
    const { api, clock, engine, getState, setState } = this.options;
    const take = this.take;
    const { status } = getState();
    if (!take || (status !== 'recording' && status !== 'paused')) return;

    setState({ status: 'finishing' });
    this.clearTailTimer();
    this.elapsed.pause(clock.nowMs());
    try {
      await this.transitions;
      if (engine.isBackingPlaying) engine.stopBacking();
      const audioFrames = await this.stopCapture(take);
      take.stopForwarding();
      if (take.video) {
        take.video.activeTimer.pause(clock.nowMs());
        await withTimeout(
          clock,
          take.video.recorder.stop(),
          DEVICE_TIMEOUT_MS,
          'Stopping the camera recording',
        );
      }

      if (audioFrames / take.sampleRate < MIN_TAKE_SEC) {
        this.take = null;
        await api.take.discard(take.takeId).catch(() => undefined);
        setState({ ...IDLE_STATE });
        return;
      }

      const finished = await api.take.finish(take.takeId, this.buildManifest(take, audioFrames));
      if (!finished.ok) throw finished.error;
      this.take = null;
      this.finished = {
        takeId: take.takeId,
        mode: take.mode,
        backingTrackName: take.backingTrackName,
      };
      setState({ status: 'review', takeDurationSec: finished.value.durationSec });
    } catch (error) {
      this.take = null;
      await this.abandon(take);
      this.failRecording(error);
    }
  }

  /** Abandons the countdown, the take in progress, or the take under review. */
  async discard(): Promise<void> {
    const { api, getState, setState } = this.options;
    if (this.starting) {
      this.cancelStart();
      await this.starting;
      return;
    }
    const { status } = getState();
    const take = this.take;
    if (take && (status === 'recording' || status === 'paused')) {
      this.take = null;
      setState({ ...IDLE_STATE, error: null });
      this.settling = this.abandon(take);
      await this.settling;
      return;
    }
    if (status === 'review' && this.finished) {
      const { takeId } = this.finished;
      this.finished = null;
      setState({ ...IDLE_STATE, error: null });
      await api.take.discard(takeId).catch(() => undefined);
    }
  }

  /** A microphone or camera went away mid-take: keep everything recorded up to now. */
  async finishAfterDeviceLoss(): Promise<void> {
    if (this.starting) {
      this.cancelStart();
      await this.starting;
      return;
    }
    await this.stop();
  }

  /** review → save dialog → exporting → saved. Cancelling the dialog stays in review. */
  async save(): Promise<void> {
    const { api, getState, now, setState } = this.options;
    const take = this.finished;
    if (this.saving || !take || getState().status !== 'review') return;

    this.saving = true;
    let unsubscribe: Unsubscribe | null = null;
    try {
      const outputPath = await api.exporter.chooseSavePath(defaultTakeFileName(now()));
      // The take may have been discarded while the dialog was open.
      if (outputPath === null || this.finished !== take || getState().status !== 'review') return;

      setState({ status: 'exporting', exportStage: 'mixing', exportProgress: 0, error: null });
      unsubscribe = api.exporter.onProgress((progress) => {
        if (progress.takeId !== take.takeId || getState().status !== 'exporting') return;
        setState({ exportStage: progress.stage, exportProgress: clamp01(progress.fraction) });
      });

      const artworkPng = take.mode === 'audio' ? await this.renderArtwork(take) : null;
      const result = await api.exporter.start({
        takeId: take.takeId,
        outputPath,
        ...(artworkPng ? { artworkPng } : {}),
      });
      if (result.ok) {
        setState({
          status: 'saved',
          savedPath: result.value.outputPath,
          exportStage: null,
          exportProgress: 1,
        });
      } else if (result.error.code === 'export-cancelled') {
        setState({ status: 'review', exportStage: null, exportProgress: 0 });
      } else {
        throw result.error;
      }
    } catch (error) {
      setState({
        status: 'review',
        exportStage: null,
        exportProgress: 0,
        error: isAppError(error) ? error : createAppError('export-failed', error),
      });
    } finally {
      unsubscribe?.();
      this.saving = false;
    }
  }

  cancelExport(): void {
    const take = this.finished;
    if (!take || this.options.getState().status !== 'exporting') return;
    void this.options.api.exporter.cancel(take.takeId).catch(() => undefined);
  }

  /** saved → idle. The temporary take is deleted; the exported file stays. */
  recordAnother(): void {
    const { api, getState, setState } = this.options;
    if (getState().status !== 'saved') return;
    const take = this.finished;
    this.finished = null;
    setState({ ...IDLE_STATE, error: null });
    if (take) void api.take.discard(take.takeId).catch(() => undefined);
  }

  openSavedFile(): void {
    const { savedPath } = this.options.getState();
    if (savedPath) void this.options.api.exporter.openFile(savedPath).catch(() => undefined);
  }

  showSavedInFolder(): void {
    const { savedPath } = this.options.getState();
    if (savedPath) void this.options.api.exporter.showInFolder(savedPath).catch(() => undefined);
  }

  /** Stops everything and deletes whatever temporary take exists. */
  async dispose(): Promise<void> {
    this.unsubscribeBackingEnded();
    this.cancelStart();
    await this.starting;
    const take = this.take;
    this.take = null;
    if (take) await this.abandon(take);
    const finished = this.finished;
    this.finished = null;
    if (finished) await this.options.api.take.discard(finished.takeId).catch(() => undefined);
  }

  // ---------------------------------------------------------------------------------------
  // Starting
  // ---------------------------------------------------------------------------------------

  /** Why live audio cannot be recorded right now, or null when it can. */
  private audioProblem(): AppError | null {
    const { engine } = this.options;
    return engine.isRunning ? engine.fault : createAppError('audio-engine-failed');
  }

  /** Why a video take cannot start right now, or null when it can. */
  private videoBlocker(): AppError | null {
    const { getCameraError, getCameraFeed, videoRecorders } = this.options;
    if (!getCameraFeed()) return getCameraError() ?? createAppError('no-camera');
    if (!pickRecorderMimeType(videoRecorders.isTypeSupported)) {
      return createAppError('recording-failed', 'No supported video recording format');
    }
    return null;
  }

  private cancelStart(): void {
    if (!this.starting) return;
    this.startCancelled = true;
    this.cancelCountdown?.();
  }

  private throwIfStartCancelled(): void {
    if (this.startCancelled) throw START_CANCELLED;
  }

  private async runStart(): Promise<void> {
    const { clock, engine, getSettings, setState } = this.options;
    setState({ ...IDLE_STATE, error: null });
    this.options.onTakeStarting();

    let take: ActiveTake | null = null;
    try {
      await this.settling;
      const { recording } = getSettings();
      if (recording.countdownEnabled) await this.countDown(recording.countdownSec);
      this.throwIfStartCancelled();

      take = await this.beginTake();
      this.throwIfStartCancelled();

      const captureAt = engine.currentTimeSec + CAPTURE_LEAD_SEC;
      const capture = engine.startCapture(captureAt);
      take.captureRequested = true;
      if (take.hasBacking) {
        engine.startBacking({ offsetSec: 0, atContextTimeSec: captureAt + BACKING_LEAD_SEC });
      }
      const started = await withTimeout(
        clock,
        capture,
        DEVICE_TIMEOUT_MS,
        'Starting the audio capture',
      );
      this.throwIfStartCancelled();

      take.captureStartContextSec = started.startContextTimeSec;
      this.lastTransitionContextSec = started.startContextTimeSec;
      this.transitions = Promise.resolve();
      this.elapsed.start(clock.nowMs());
      this.take = take;
      setState({ status: 'recording', countdownRemaining: 0 });
    } catch (error) {
      if (take) await this.abandon(take);
      if (error === START_CANCELLED) setState({ ...IDLE_STATE });
      else this.failRecording(error);
    }
  }

  /** One tick per second; resolves when it reaches zero or the start is cancelled. */
  private countDown(seconds: number): Promise<void> {
    const { clock, setState } = this.options;
    return new Promise((resolve) => {
      let remaining = Math.max(1, Math.round(seconds));
      let timer = 0;
      const finish = (): void => {
        clock.clearTimeout(timer);
        this.cancelCountdown = null;
        resolve();
      };
      const tick = (): void => {
        remaining -= 1;
        setState({ countdownRemaining: remaining });
        if (remaining <= 0) finish();
        else timer = clock.setTimeout(tick, 1000);
      };
      setState({ status: 'countdown', countdownRemaining: remaining });
      timer = clock.setTimeout(tick, 1000);
      this.cancelCountdown = finish;
    });
  }

  /** Opens the take in the main process and starts everything except the audio capture. */
  private async beginTake(): Promise<ActiveTake> {
    const { api, engine, getBackingTrackName, getCameraFeed, getSettings, videoRecorders } =
      this.options;
    // The countdown took a while: the devices may have changed under it.
    const audioProblem = this.audioProblem();
    if (audioProblem) throw audioProblem;
    const { mode } = getSettings();
    const feed = mode === 'video' ? getCameraFeed() : null;
    const mimeType = feed ? pickRecorderMimeType(videoRecorders.isTypeSupported) : null;
    if (mode === 'video' && (!feed || !mimeType)) {
      throw this.videoBlocker() ?? createAppError('no-camera');
    }

    const init: TakeInit = { mode, sampleRate: engine.sampleRate };
    if (feed && mimeType) {
      init.video = {
        mimeType,
        width: feed.width,
        height: feed.height,
        frameRate: feed.frameRate,
      };
    }
    const begun = await api.take.begin(init);
    if (!begun.ok) throw begun.error;
    const { takeId } = begun.value;
    if (this.startCancelled) {
      await api.take.discard(takeId).catch(() => undefined);
      throw START_CANCELLED;
    }

    const take: ActiveTake = {
      takeId,
      mode,
      sampleRate: engine.sampleRate,
      hasBacking: engine.hasBackingTrack,
      backingTrackName: engine.hasBackingTrack ? getBackingTrackName() : null,
      video: null,
      captureRequested: false,
      captureStopped: false,
      captureStartContextSec: 0,
      pauses: 0,
      pausedSongPositionSec: null,
      backingEnded: false,
      framesForwarded: 0,
      stopForwarding: () => undefined,
    };
    take.stopForwarding = engine.onStemChunk((chunk) => {
      api.take.appendAudio(takeId, chunk);
      take.framesForwarded += chunk.vocal.byteLength / STEM_BYTES_PER_FRAME;
    });

    if (feed && mimeType) {
      try {
        await this.startVideo(take, feed, mimeType);
      } catch (error) {
        await this.abandon(take);
        throw error;
      }
    }
    return take;
  }

  private async startVideo(take: ActiveTake, feed: CameraFeed, mimeType: string): Promise<void> {
    const { api, videoRecorders } = this.options;
    const recorder = videoRecorders.create(feed.stream, {
      mimeType,
      videoBitsPerSecond: recorderBitsPerSecond(feed.width, feed.height),
      onChunk: (chunk) => api.take.appendVideo(take.takeId, chunk),
      onError: () => this.handleRecorderFailure(take),
    });
    const video: VideoCapture = {
      recorder,
      startedMs: 0,
      activeTimer: new ElapsedTimer(),
      width: feed.width,
      height: feed.height,
      frameRate: feed.frameRate,
      cameraLatencyMs: feed.latencyMs,
    };
    take.video = video;
    video.startedMs = await recorder.start();
    video.activeTimer.start(video.startedMs);
  }

  // ---------------------------------------------------------------------------------------
  // Pause and resume
  // ---------------------------------------------------------------------------------------

  private enqueueTransition(take: ActiveTake, work: () => Promise<void>): void {
    this.transitions = this.transitions.then(work).catch(() => {
      // A capture that no longer follows orders cannot be trusted to stay in step: stop
      // here and keep what was recorded.
      const { status } = this.options.getState();
      if (this.take !== take || (status !== 'recording' && status !== 'paused')) return;
      this.options.notify('warning', 'Recording was stopped early. Your take was kept.');
      void this.stop();
    });
  }

  private nextTransitionContextSec(): number {
    const at = Math.max(
      this.options.engine.currentTimeSec + TRANSITION_LEAD_SEC,
      this.lastTransitionContextSec + MIN_TRANSITION_GAP_SEC,
    );
    this.lastTransitionContextSec = at;
    return at;
  }

  private async pauseTake(take: ActiveTake): Promise<void> {
    const { clock, engine } = this.options;
    const at = this.nextTransitionContextSec();
    const capturePaused = engine.pauseCapture(at);
    take.pausedSongPositionSec = engine.isBackingPlaying ? engine.stopBacking(at) : null;
    take.pauses += 1;
    const video = take.video;
    if (video) {
      await this.waitForPictureOf(at, video);
      video.recorder.pause();
      video.activeTimer.pause(clock.nowMs());
    }
    await capturePaused;
  }

  private async resumeTake(take: ActiveTake): Promise<void> {
    const { clock, engine } = this.options;
    const at = this.nextTransitionContextSec();
    const captureResumed = engine.resumeCapture(at);
    if (take.pausedSongPositionSec !== null && engine.hasBackingTrack) {
      engine.startBacking({ offsetSec: take.pausedSongPositionSec, atContextTimeSec: at });
    }
    take.pausedSongPositionSec = null;
    const video = take.video;
    if (video) {
      await this.waitForPictureOf(at, video);
      video.recorder.resume();
      video.activeTimer.resume(clock.nowMs());
    }
    await captureResumed;
    if (take.backingEnded && this.take === take && this.options.getState().status === 'recording') {
      this.armTailTimer();
    }
  }

  /**
   * Waits until the camera frames that show the moment the sound at `contextTimeSec` is
   * heard reach the recorder, so pausing cuts the same span out of the picture as out of
   * the stems.
   */
  private async waitForPictureOf(contextTimeSec: number, video: VideoCapture): Promise<void> {
    const { clock } = this.options;
    const cameraLatencyMs = this.options.getCameraFeed()?.latencyMs ?? video.cameraLatencyMs;
    const waitMs = this.heardAtMs(contextTimeSec) + cameraLatencyMs - clock.nowMs();
    await sleep(clock, Math.min(MAX_VIDEO_TRANSITION_WAIT_MS, waitMs));
  }

  /** performance.now() time at which the audio rendered at `contextTimeSec` is heard. */
  private heardAtMs(contextTimeSec: number): number {
    const { clock, engine } = this.options;
    const outputClock = engine.getOutputClock();
    if (outputClock.isReady) return outputClock.heardAtMs(contextTimeSec);
    const aheadSec = contextTimeSec - engine.currentTimeSec + engine.getLatency().outputSec;
    return clock.nowMs() + aheadSec * 1000;
  }

  // ---------------------------------------------------------------------------------------
  // Finishing
  // ---------------------------------------------------------------------------------------

  private handleBackingEnded(): void {
    const take = this.take;
    if (!take) return;
    take.backingEnded = true;
    if (this.options.getState().status === 'recording') this.armTailTimer();
  }

  private armTailTimer(): void {
    this.clearTailTimer();
    this.tailTimer = this.options.clock.setTimeout(() => {
      this.tailTimer = null;
      void this.stop();
    }, BACKING_TAIL_MS);
  }

  private clearTailTimer(): void {
    if (this.tailTimer === null) return;
    this.options.clock.clearTimeout(this.tailTimer);
    this.tailTimer = null;
  }

  private handleRecorderFailure(take: ActiveTake): void {
    if (this.take !== take) return;
    this.options.notify('warning', 'The camera stopped recording. Your take was kept.');
    void this.stop();
  }

  /**
   * Stops the audio capture and returns the frames captured per stem. If the engine no
   * longer answers, the frames that already reached the take are what was recorded.
   */
  private async stopCapture(take: ActiveTake): Promise<number> {
    const { clock, engine } = this.options;
    take.captureStopped = true;
    try {
      const stopping = engine.stopCapture();
      const { frames } = await withTimeout(
        clock,
        stopping,
        DEVICE_TIMEOUT_MS,
        'Stopping the audio capture',
      );
      return frames;
    } catch {
      return take.framesForwarded;
    }
  }

  private buildManifest(take: ActiveTake, audioFrames: number): TakeManifest {
    const { clock, engine, getCameraFeed, getSettings } = this.options;
    const latency = engine.getLatency();
    const video = take.video;
    return buildTakeManifest({
      mode: take.mode,
      sampleRate: take.sampleRate,
      audioFrames,
      hasBacking: take.hasBacking,
      pauses: take.pauses,
      latency,
      sync: getSettings().sync,
      captureStartContextSec: take.captureStartContextSec,
      clock: this.usableOutputClock(latency),
      video: video
        ? {
            recorderStartedMs: video.startedMs,
            activeDurationSec: video.activeTimer.elapsedMs(clock.nowMs()) / 1000,
            width: video.width,
            height: video.height,
            frameRate: video.frameRate,
            // The estimate has had the whole take to settle; prefer it to the one at the start.
            cameraLatencyMs: getCameraFeed()?.latencyMs ?? video.cameraLatencyMs,
          }
        : null,
    });
  }

  /** The engine's clock mapping, or one derived from its reported latency when it has none. */
  private usableOutputClock(latency: LatencyBreakdown): OutputClock {
    const { clock, engine } = this.options;
    const outputClock = engine.getOutputClock();
    if (outputClock.isReady) return outputClock;
    const fallback = new OutputClock();
    fallback.addSample(
      outputTimestampFromLatency(engine.currentTimeSec, clock.nowMs(), latency.outputSec),
    );
    return fallback;
  }

  /** Stops whatever the take had running and deletes its files. Never rejects. */
  private async abandon(take: ActiveTake): Promise<void> {
    const { api, clock, engine } = this.options;
    this.clearTailTimer();
    await this.transitions;
    if (take.captureRequested && !take.captureStopped) {
      take.captureStopped = true;
      try {
        if (take.hasBacking) engine.stopBacking();
        await withTimeout(
          clock,
          engine.stopCapture(),
          DEVICE_TIMEOUT_MS,
          'Stopping the audio capture',
        );
      } catch {
        // The take is being thrown away; a capture that will not stop cleanly changes nothing.
      }
    }
    take.stopForwarding();
    if (take.video) {
      await withTimeout(
        clock,
        take.video.recorder.stop(),
        DEVICE_TIMEOUT_MS,
        'Stopping the camera recording',
      ).catch(() => undefined);
    }
    await api.take.discard(take.takeId).catch(() => undefined);
  }

  private failRecording(cause: unknown): void {
    const error = isAppError(cause) ? cause : createAppError('recording-failed', cause);
    this.options.setState({ ...IDLE_STATE, error });
    this.options.notify('error', error.message);
  }

  /** Artwork is a nicety: without it the exporter shows its plain dark frame. */
  private async renderArtwork(take: FinishedTake): Promise<ArrayBuffer | null> {
    try {
      return await this.options.renderTakeArtwork({
        backingTrackName: take.backingTrackName,
        date: this.options.now(),
      });
    } catch {
      return null;
    }
  }
}
