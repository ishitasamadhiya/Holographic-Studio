// Everything the studio needs from its environment. The app passes nothing and gets the real
// browser, Electron and worker implementations; tests pass fakes for all of it.
import { createAnalysisClient, type AnalysisClient } from '@analysis/index';
import type { RawHandFrame } from '@gestures/index';
import { createAudioEngine } from '@renderer/audio/createAudioEngine';
import type { AudioEngine } from '@renderer/audio/engineTypes';
import type { MediaDevicesLike } from '@renderer/camera/mediaDevices';
import { createBrowserClock, type Clock } from '@renderer/recording/clock';
import { renderTakeArtwork, type TakeArtworkRenderer } from '@renderer/recording/takeArtwork';
import {
  createVideoRecorderFactory,
  type VideoRecorderFactory,
} from '@renderer/recording/videoRecorder';
import { HandTracker } from '@renderer/tracking/handTracker';
import type { AppError } from '@shared/errors';
import type { HoloApi, Unsubscribe } from '@shared/ipc';

/** The part of HandTracker the studio uses. */
export interface HandTrackerLike {
  readonly running: boolean;
  /** Never rejects; failures arrive through onError. */
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  onFrame(listener: (frame: RawHandFrame) => void): Unsubscribe;
  onError(listener: (error: AppError) => void): Unsubscribe;
}

export interface StudioDependencies {
  /** window.holo */
  api: HoloApi;
  createAudioEngine: () => AudioEngine;
  createHandTracker: () => HandTrackerLike;
  createAnalysisClient: () => AnalysisClient;
  mediaDevices: MediaDevicesLike;
  clock: Clock;
  /** MediaRecorder behind a small interface. */
  videoRecorders: VideoRecorderFactory;
  /** Paints the Audio Only artwork (canvas). */
  renderTakeArtwork: TakeArtworkRenderer;
  /** Wall-clock date, for file names and the artwork. */
  now: () => Date;
}

/** Fills in the real implementation of every dependency that was not supplied. */
export function resolveStudioDependencies(
  overrides: Partial<StudioDependencies> = {},
): StudioDependencies {
  const clock = overrides.clock ?? createBrowserClock();
  return {
    api: overrides.api ?? window.holo,
    createAudioEngine: overrides.createAudioEngine ?? createAudioEngine,
    createHandTracker: overrides.createHandTracker ?? (() => new HandTracker()),
    createAnalysisClient: overrides.createAnalysisClient ?? (() => createAnalysisClient()),
    mediaDevices: overrides.mediaDevices ?? navigator.mediaDevices,
    clock,
    videoRecorders: overrides.videoRecorders ?? createVideoRecorderFactory(clock),
    renderTakeArtwork: overrides.renderTakeArtwork ?? renderTakeArtwork,
    now: overrides.now ?? (() => new Date()),
  };
}
