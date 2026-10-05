// The display-rate loop: resolves the three controls (hand or slider) and sends them to the
// audio engine, and refreshes the live readouts (meters, timers, song position).
import { ControlResolver, type GestureFrame } from '@gestures/index';
import type { AudioEngine } from '@renderer/audio/engineTypes';
import type { Clock } from '@renderer/recording/clock';
import { computeMonitoringLatencySec } from '@renderer/recording/syncTimeline';
import type { LiveReadouts, StudioState } from '@renderer/state/studioTypes';

/**
 * Animation frames stop while the window is hidden or covered. Controls must keep reaching
 * the engine regardless, so a timer takes over whenever no frame arrives for this long.
 */
export const FRAME_WATCHDOG_MS = 100;
/** How often the monitoring-latency estimate is re-read from the engine. */
const LATENCY_REFRESH_MS = 1000;

export interface LiveLoopOptions {
  clock: Clock;
  live: LiveReadouts;
  getState: () => StudioState;
  getEngine: () => AudioEngine;
  getGesture: () => GestureFrame | null;
  getRecordingElapsedSec: (nowMs: number) => number;
  onMonitoringLatency: (latencyMs: number) => void;
}

export class LiveLoop {
  private readonly resolver = new ControlResolver();
  private frameHandle: number | null = null;
  private watchdogHandle: number | null = null;
  private lastLatencyRefreshMs = Number.NEGATIVE_INFINITY;
  private failureReported = false;

  constructor(private readonly options: LiveLoopOptions) {}

  get isRunning(): boolean {
    return this.frameHandle !== null;
  }

  start(): void {
    if (this.isRunning) return;
    this.schedule();
  }

  stop(): void {
    const { clock } = this.options;
    if (this.frameHandle !== null) clock.cancelFrame(this.frameHandle);
    if (this.watchdogHandle !== null) clock.clearTimeout(this.watchdogHandle);
    this.frameHandle = null;
    this.watchdogHandle = null;
  }

  /** Runs one update immediately (also what every frame does). */
  tick(nowMs: number = this.options.clock.nowMs()): void {
    const { getEngine, getGesture, getRecordingElapsedSec, getState, live } = this.options;
    const state = getState();
    const engine = getEngine();
    const gesture = state.tracking.status === 'running' ? getGesture() : null;
    const gesturesAvailable =
      state.settings.mode === 'video' &&
      state.camera.status === 'running' &&
      state.tracking.status === 'running';

    const resolved = this.resolver.resolve(
      gesture,
      { gesturesAvailable, controls: state.settings.controls },
      nowMs,
    );
    Object.assign(live.controls, resolved.values);
    Object.assign(live.controlStatus, resolved.status);
    live.gesture = gesture;
    live.recordingElapsedSec = getRecordingElapsedSec(nowMs);

    if (!engine.isRunning) {
      live.inputLevel = 0;
      live.outputLevel = 0;
      live.detectedMidi = null;
      live.targetMidi = null;
      live.songPositionSec = null;
      return;
    }
    engine.setControls({ ...resolved.values });
    const meters = engine.readMeters();
    live.inputLevel = meters.inputLevel;
    live.outputLevel = meters.outputLevel;
    live.detectedMidi = meters.detectedMidi;
    live.targetMidi = meters.targetMidi;
    live.songPositionSec = engine.getSongPositionSec();

    if (nowMs - this.lastLatencyRefreshMs >= LATENCY_REFRESH_MS) {
      this.lastLatencyRefreshMs = nowMs;
      this.options.onMonitoringLatency(computeMonitoringLatencySec(engine.getLatency()) * 1000);
    }
  }

  private schedule(): void {
    const { clock } = this.options;
    this.frameHandle = clock.requestFrame((nowMs) => this.onFrame(nowMs));
    this.watchdogHandle = clock.setTimeout(() => this.onFrame(clock.nowMs()), FRAME_WATCHDOG_MS);
  }

  private onFrame(nowMs: number): void {
    this.stop();
    try {
      this.tick(nowMs);
    } catch (error) {
      // One bad frame must not end the loop that keeps the controls flowing.
      if (!this.failureReported) console.warn('Live update failed', error);
      this.failureReported = true;
    }
    this.schedule();
  }
}
