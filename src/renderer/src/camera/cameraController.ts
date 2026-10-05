// Owns the camera: opening it at the best size it supports, showing it in the preview
// element, noticing when it goes away, and measuring how late its frames arrive.
import { CameraLatencyEstimator } from '@renderer/recording/syncTimeline';
import type { CameraState } from '@renderer/state/studioTypes';
import { createAppError, ok, type AppError, type Result } from '@shared/errors';
import { VIDEO_RESOLUTIONS, type VideoResolution } from '@shared/settings';
import { CAMERA_FRAME_RATE, cameraConstraintLadder } from './cameraConstraints';
import { cameraErrorFrom, isMissingDevice, isUnsupportedConstraint } from './cameraErrors';
import type { MediaDevicesLike } from './mediaDevices';

export interface CameraStartOptions {
  /** null = the system default camera. */
  deviceId: string | null;
  resolution: VideoResolution;
}

export interface CameraStarted {
  /** True when the requested camera was missing and the default one was opened instead. */
  usedDefaultDevice: boolean;
}

/** The running camera as other parts of the app consume it. */
export interface RunningCamera {
  stream: MediaStream;
  width: number;
  height: number;
  frameRate: number;
  /** Sensor-to-app delay in milliseconds (a typical value until enough frames were timed). */
  latencyMs: number;
}

export interface CameraControllerOptions {
  mediaDevices: MediaDevicesLike;
  onState: (state: CameraState) => void;
  /** The running camera stopped by itself (unplugged, or taken over by the system). */
  onLost: (error: AppError) => void;
  /** The preview element was attached, replaced or detached. */
  onPreviewChanged: () => void;
}

interface OpenCamera {
  stream: MediaStream;
  track: MediaStreamTrack;
  width: number;
  height: number;
  frameRate: number;
  stopWatching: () => void;
}

const OFF_STATE: CameraState = { status: 'off', error: null, width: 0, height: 0 };

export class CameraController {
  private camera: OpenCamera | null = null;
  private previewElement: HTMLVideoElement | null = null;
  private frameCallbackId: number | null = null;
  /** Bumped by every start() and stop(), so an older start that finishes late is dropped. */
  private generation = 0;
  private readonly latency = new CameraLatencyEstimator();

  constructor(private readonly options: CameraControllerOptions) {}

  get running(): RunningCamera | null {
    const camera = this.camera;
    if (!camera) return null;
    return {
      stream: camera.stream,
      width: camera.width,
      height: camera.height,
      frameRate: camera.frameRate,
      latencyMs: this.latency.latencyMs,
    };
  }

  /** The element currently showing the camera, if the UI has handed one over. */
  get preview(): HTMLVideoElement | null {
    return this.previewElement;
  }

  /** Opens the camera (restarting it when it is already open). Errors also land in onState. */
  async start(request: CameraStartOptions): Promise<Result<CameraStarted>> {
    const generation = ++this.generation;
    this.release();
    this.options.onState({ ...OFF_STATE, status: 'starting' });

    let opened: { stream: MediaStream; usedDefaultDevice: boolean };
    try {
      opened = await this.open(request);
    } catch (cause) {
      const error = cameraErrorFrom(cause);
      if (generation === this.generation) {
        this.options.onState({ ...OFF_STATE, status: 'error', error });
      }
      return { ok: false, error };
    }

    const { stream, usedDefaultDevice } = opened;
    const track = stream.getVideoTracks()[0];
    if (generation !== this.generation || !track) {
      for (const stale of stream.getTracks()) stale.stop();
      if (generation !== this.generation) return ok({ usedDefaultDevice });
      const error = createAppError('no-camera', 'The camera stream has no video track');
      this.options.onState({ ...OFF_STATE, status: 'error', error });
      return { ok: false, error };
    }

    const requested = VIDEO_RESOLUTIONS[request.resolution];
    const settings = track.getSettings();
    const onEnded = (): void => this.handleTrackEnded(track);
    track.addEventListener('ended', onEnded);
    this.camera = {
      stream,
      track,
      width: settings.width ?? requested.width,
      height: settings.height ?? requested.height,
      frameRate: settings.frameRate ?? CAMERA_FRAME_RATE,
      stopWatching: () => track.removeEventListener('ended', onEnded),
    };
    this.latency.reset();
    if (this.previewElement) this.show(this.previewElement, stream);
    this.options.onState({
      status: 'running',
      error: null,
      width: this.camera.width,
      height: this.camera.height,
    });
    return ok({ usedDefaultDevice });
  }

  stop(): void {
    this.generation += 1;
    this.release();
    this.options.onState({ ...OFF_STATE });
  }

  /**
   * Shows the camera in `element` (muted and inline) and keeps showing it across camera
   * restarts. Pass null to let go of the element.
   */
  attachPreview(element: HTMLVideoElement | null): void {
    if (element === this.previewElement) return;
    const previous = this.previewElement;
    if (previous) {
      this.stopTimingFrames(previous);
      previous.srcObject = null;
    }
    this.previewElement = element;
    if (element) {
      element.muted = true;
      element.playsInline = true;
      this.show(element, this.camera?.stream ?? null);
      this.timeFrames(element);
    }
    this.options.onPreviewChanged();
  }

  /** Tries each size in turn; falls back to the default camera when the chosen one is gone. */
  private async open(
    request: CameraStartOptions,
  ): Promise<{ stream: MediaStream; usedDefaultDevice: boolean }> {
    let lastError: unknown = new Error('No camera constraints to try');
    for (const video of cameraConstraintLadder(request.deviceId, request.resolution)) {
      try {
        const stream = await this.options.mediaDevices.getUserMedia({ video, audio: false });
        return { stream, usedDefaultDevice: false };
      } catch (error) {
        lastError = error;
        // Only "this size is not available" is worth another attempt at the same camera.
        if (!isUnsupportedConstraint(error)) break;
      }
    }
    if (request.deviceId !== null && isMissingDevice(lastError)) {
      const { stream } = await this.open({ ...request, deviceId: null });
      return { stream, usedDefaultDevice: true };
    }
    throw lastError;
  }

  private show(element: HTMLVideoElement, stream: MediaStream | null): void {
    element.srcObject = stream;
    // play() is rejected when a newer stream replaces this one first; that is not a failure.
    if (stream) void element.play().catch(() => undefined);
  }

  /** Feeds the latency estimate from the capture timestamps of the frames being shown. */
  private timeFrames(element: HTMLVideoElement): void {
    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (this.previewElement !== element) return;
      this.latency.addFrame(metadata.captureTime, metadata.presentationTime);
      this.frameCallbackId = element.requestVideoFrameCallback(onFrame);
    };
    this.frameCallbackId = element.requestVideoFrameCallback(onFrame);
  }

  private stopTimingFrames(element: HTMLVideoElement): void {
    if (this.frameCallbackId !== null) element.cancelVideoFrameCallback(this.frameCallbackId);
    this.frameCallbackId = null;
  }

  private handleTrackEnded(track: MediaStreamTrack): void {
    if (this.camera?.track !== track) return;
    this.generation += 1;
    this.release();
    const error = createAppError('device-disconnected', 'The camera track ended');
    this.options.onState({ ...OFF_STATE, status: 'error', error });
    this.options.onLost(error);
  }

  private release(): void {
    const camera = this.camera;
    if (!camera) return;
    this.camera = null;
    camera.stopWatching();
    for (const track of camera.stream.getTracks()) track.stop();
    if (this.previewElement) this.previewElement.srcObject = null;
  }
}
