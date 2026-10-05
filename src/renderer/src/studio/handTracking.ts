// Runs the hand tracker while the conditions for it hold, and turns its raw landmarks into
// gesture frames (GesturePipeline) and optional extra-gesture events.
import {
  ExtraGestureDetector,
  GesturePipeline,
  type ExtraGestureEvent,
  type GestureFrame,
  type RawHandFrame,
} from '@gestures/index';
import type { TrackingState } from '@renderer/state/studioTypes';
import type { AppError } from '@shared/errors';
import type { Unsubscribe } from '@shared/ipc';
import type { HandTrackerLike } from './studioDependencies';

export interface HandTrackingOptions {
  createTracker: () => HandTrackerLike;
  onState: (state: TrackingState) => void;
  /** The tracker failed; tracking stays off until the conditions change. */
  onFailure: (error: AppError) => void;
  onExtraGesture: (event: ExtraGestureEvent) => void;
}

const OFF: TrackingState = { status: 'off', error: null };

export class HandTracking {
  private readonly pipeline = new GesturePipeline();
  private readonly extraGestures = new ExtraGestureDetector();
  private readonly gestureListeners = new Set<(frame: GestureFrame) => void>();
  private tracker: HandTrackerLike | null = null;
  private trackerSubscriptions: Unsubscribe[] = [];
  /** The element being tracked, or null when tracking is off. */
  private source: HTMLVideoElement | null = null;
  /** Bumped on every start and stop, so a start that completes late is recognised as stale. */
  private generation = 0;
  /** Set when the tracker failed for the current source; cleared when tracking is turned off. */
  private failed = false;
  private extraGesturesEnabled = false;
  private latestFrame: GestureFrame | null = null;

  constructor(private readonly options: HandTrackingOptions) {}

  /** Most recent interpreted hands while tracking runs, else null. */
  get latest(): GestureFrame | null {
    return this.latestFrame;
  }

  /**
   * Starts tracking `video`, or stops when it is null. Calling it again with the same element
   * does nothing, so it can be called whenever anything that matters might have changed.
   */
  sync(video: HTMLVideoElement | null): void {
    if (video === null) {
      this.failed = false;
      this.stop();
      return;
    }
    if (video === this.source || this.failed) return;
    this.start(video);
  }

  setNeutralHandScale(scale: number | null): void {
    this.pipeline.setNeutralHandScale(scale);
  }

  setExtraGesturesEnabled(enabled: boolean): void {
    if (enabled === this.extraGesturesEnabled) return;
    this.extraGesturesEnabled = enabled;
    this.extraGestures.reset();
  }

  /** Receives every gesture frame while tracking runs (calibration listens here). */
  onGesture(listener: (frame: GestureFrame) => void): Unsubscribe {
    this.gestureListeners.add(listener);
    return () => {
      this.gestureListeners.delete(listener);
    };
  }

  /** Stops tracking and lets go of the tracker for good. */
  dispose(): void {
    this.stop();
    this.gestureListeners.clear();
    for (const unsubscribe of this.trackerSubscriptions) unsubscribe();
    this.trackerSubscriptions = [];
    this.tracker = null;
  }

  private start(video: HTMLVideoElement): void {
    this.stop();
    const generation = ++this.generation;
    const tracker = this.ensureTracker();
    this.source = video;
    this.options.onState({ status: 'starting', error: null });
    void tracker.start(video).then(() => {
      if (generation !== this.generation || this.failed) return;
      if (tracker.running) this.options.onState({ status: 'running', error: null });
    });
  }

  private stop(): void {
    this.generation += 1;
    const wasActive = this.source !== null;
    this.source = null;
    this.latestFrame = null;
    this.pipeline.reset();
    this.extraGestures.reset();
    this.tracker?.stop();
    if (wasActive && !this.failed) this.options.onState({ ...OFF });
  }

  private ensureTracker(): HandTrackerLike {
    if (this.tracker) return this.tracker;
    const tracker = this.options.createTracker();
    this.trackerSubscriptions = [
      tracker.onFrame((frame) => this.handleFrame(frame)),
      tracker.onError((error) => this.handleError(error)),
    ];
    this.tracker = tracker;
    return tracker;
  }

  private handleFrame(raw: RawHandFrame): void {
    if (this.source === null) return;
    const frame = this.pipeline.update(raw);
    this.latestFrame = frame;
    for (const listener of this.gestureListeners) listener(frame);
    if (!this.extraGesturesEnabled) return;
    for (const event of this.extraGestures.update(frame, raw)) this.options.onExtraGesture(event);
  }

  private handleError(error: AppError): void {
    if (this.source === null || this.failed) return;
    this.failed = true;
    this.generation += 1;
    this.latestFrame = null;
    this.tracker?.stop();
    this.options.onState({ status: 'error', error });
    this.options.onFailure(error);
  }
}
