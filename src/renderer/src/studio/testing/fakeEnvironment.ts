// Fake browser pieces for the studio tests: media devices with a camera, a preview element,
// the hand tracker and the analysis worker client.
import type { AlignmentEstimate, AnalysisClient, StereoPcm } from '@analysis/index';
import type { RawHandFrame } from '@gestures/index';
import type { DeviceInfoLike, MediaDevicesLike } from '@renderer/camera/mediaDevices';
import { deferred, type Deferred } from '@renderer/recording/testing/fakeApi';
import type { AppError } from '@shared/errors';
import type { Unsubscribe } from '@shared/ipc';
import type { ReferenceAnalysis } from '@shared/music';
import type { HandTrackerLike } from '../studioDependencies';

export class FakeTrack {
  stopped = false;
  private readonly endedListeners = new Set<() => void>();

  constructor(
    readonly kind: 'video' | 'audio',
    private readonly settings: MediaTrackSettings,
  ) {}

  getSettings(): MediaTrackSettings {
    return this.settings;
  }

  stop(): void {
    this.stopped = true;
  }

  addEventListener(_type: 'ended', listener: () => void): void {
    this.endedListeners.add(listener);
  }

  removeEventListener(_type: 'ended', listener: () => void): void {
    this.endedListeners.delete(listener);
  }

  /** The device went away. */
  end(): void {
    for (const listener of [...this.endedListeners]) listener();
  }
}

export function fakeStream(track: FakeTrack): MediaStream {
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => (track.kind === 'video' ? [track] : []),
  };
  return stream as unknown as MediaStream;
}

function domError(name: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(name), { name, ...extra });
}

export class FakeMediaDevices implements MediaDevicesLike {
  devices: DeviceInfoLike[] = [
    { deviceId: 'default', kind: 'audioinput', label: 'Default - Built-in Microphone' },
    { deviceId: 'mic-1', kind: 'audioinput', label: 'Built-in Microphone' },
    { deviceId: 'mic-2', kind: 'audioinput', label: 'USB Microphone' },
    { deviceId: 'communications', kind: 'audioinput', label: 'Communications' },
    { deviceId: 'cam-1', kind: 'videoinput', label: 'FaceTime HD Camera' },
    { deviceId: 'default', kind: 'audiooutput', label: 'Default - Headphones' },
    { deviceId: 'out-1', kind: 'audiooutput', label: 'Headphones' },
  ];
  /** Largest size the camera can deliver. */
  cameraSize = { width: 1920, height: 1080 };
  /** When set, getUserMedia fails with a DOMException of this name. */
  failWith: string | null = null;
  readonly requests: MediaStreamConstraints[] = [];
  readonly tracks: FakeTrack[] = [];
  private readonly changeListeners = new Set<() => void>();

  async enumerateDevices(): Promise<DeviceInfoLike[]> {
    return this.devices.map((device) => ({ ...device }));
  }

  async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    this.requests.push(constraints);
    if (this.failWith) throw domError(this.failWith);
    const video = constraints.video as MediaTrackConstraints;
    const deviceId = (video.deviceId as ConstrainDOMStringParameters | undefined)?.exact;
    if (deviceId !== undefined && !this.devices.some((device) => device.deviceId === deviceId)) {
      throw domError('OverconstrainedError', { constraint: 'deviceId' });
    }
    const width = (video.width as ConstrainULongRange | undefined)?.exact;
    const height = (video.height as ConstrainULongRange | undefined)?.exact;
    if (width !== undefined && width > this.cameraSize.width) {
      throw domError('OverconstrainedError', { constraint: 'width' });
    }
    const track = new FakeTrack('video', {
      width: width ?? this.cameraSize.width,
      height: height ?? this.cameraSize.height,
      frameRate: 30,
    });
    this.tracks.push(track);
    return fakeStream(track);
  }

  addEventListener(_type: 'devicechange', listener: () => void): void {
    this.changeListeners.add(listener);
  }

  removeEventListener(_type: 'devicechange', listener: () => void): void {
    this.changeListeners.delete(listener);
  }

  get listenerCount(): number {
    return this.changeListeners.size;
  }

  emitDeviceChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  get latestTrack(): FakeTrack {
    const track = this.tracks.at(-1);
    if (!track) throw new Error('No camera was opened');
    return track;
  }
}

/** The members of <video> the app touches. */
export interface FakeVideoElement {
  srcObject: MediaStream | null;
  muted: boolean;
  playsInline: boolean;
  plays: number;
  play(): Promise<void>;
  requestVideoFrameCallback(callback: VideoFrameRequestCallback): number;
  cancelVideoFrameCallback(handle: number): void;
}

export function fakeVideoElement(): HTMLVideoElement {
  const element: FakeVideoElement = {
    srcObject: null,
    muted: false,
    playsInline: false,
    plays: 0,
    play() {
      element.plays += 1;
      return Promise.resolve();
    },
    requestVideoFrameCallback: () => 1,
    cancelVideoFrameCallback: () => undefined,
  };
  return element as unknown as HTMLVideoElement;
}

export class FakeHandTracker implements HandTrackerLike {
  running = false;
  readonly started: HTMLVideoElement[] = [];
  stops = 0;
  /** When set, start() fails with it. */
  failure: AppError | null = null;
  private readonly frameListeners = new Set<(frame: RawHandFrame) => void>();
  private readonly errorListeners = new Set<(error: AppError) => void>();

  async start(video: HTMLVideoElement): Promise<void> {
    this.started.push(video);
    if (this.failure) {
      this.fail(this.failure);
      return;
    }
    this.running = true;
  }

  stop(): void {
    this.stops += 1;
    this.running = false;
  }

  onFrame(listener: (frame: RawHandFrame) => void): Unsubscribe {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onError(listener: (error: AppError) => void): Unsubscribe {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  emitFrame(frame: RawHandFrame): void {
    for (const listener of this.frameListeners) listener(frame);
  }

  fail(error: AppError): void {
    this.running = false;
    for (const listener of this.errorListeners) listener(error);
  }
}

interface PendingAnalysis {
  pcm: StereoPcm;
  onProgress?: (fraction: number) => void;
  result: Deferred<ReferenceAnalysis>;
}

export class FakeAnalysisClient implements AnalysisClient {
  readonly analyses: PendingAnalysis[] = [];
  readonly alignments: Array<{
    backing: StereoPcm;
    reference: StereoPcm;
    result: Deferred<AlignmentEstimate>;
  }> = [];
  disposed = false;

  analyze(pcm: StereoPcm, onProgress?: (fraction: number) => void): Promise<ReferenceAnalysis> {
    const result = deferred<ReferenceAnalysis>();
    this.analyses.push({ pcm, onProgress, result });
    return result.promise;
  }

  align(backing: StereoPcm, reference: StereoPcm): Promise<AlignmentEstimate> {
    const result = deferred<AlignmentEstimate>();
    this.alignments.push({ backing, reference, result });
    return result.promise;
  }

  dispose(): void {
    this.disposed = true;
  }
}

export function referenceAnalysis(overrides: Partial<ReferenceAnalysis> = {}): ReferenceAnalysis {
  return {
    schemaVersion: 1,
    durationSec: 30,
    contour: { hopSec: 0.01, f0Hz: [], confidence: [] },
    notes: [
      { startSec: 1, endSec: 2, midi: 69, confidence: 0.9 },
      { startSec: 2, endSec: 3, midi: 72, confidence: 0.9 },
    ],
    key: { tonic: 9, mode: 'minor', confidence: 0.8 },
    tuningCents: 0,
    quality: 'good',
    stats: { voicedRatio: 0.6, meanConfidence: 0.8, noteCount: 2 },
    ...overrides,
  };
}
