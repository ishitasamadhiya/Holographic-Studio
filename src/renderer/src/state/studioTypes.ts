// The contract between the UI and everything behind it. Screens read StudioState, call
// StudioActions, and read LiveReadouts for values that change many times per second.
// The real implementation lives in src/renderer/src/studio; screens never import it.
import type { StoreApi } from 'zustand';
import type { ControlStatus, GestureFrame } from '@gestures/index';
import type { ControlId, ControlSource, ControlValues } from '@shared/controls';
import type { AppError } from '@shared/errors';
import type { AppInfo, MediaKind, PermissionStatus } from '@shared/ipc';
import type { DeepPartial, RecordingMode, Settings } from '@shared/settings';
import type { ExportStage } from '@shared/take';

export type AppPhase = 'loading' | 'wizard' | 'studio';

export interface DeviceOption {
  /** MediaDeviceInfo.deviceId. */
  id: string;
  label: string;
}

export interface DevicesState {
  microphones: DeviceOption[];
  cameras: DeviceOption[];
  outputs: DeviceOption[];
  /** False where the platform cannot switch output devices; offer only "System default". */
  outputSelectionSupported: boolean;
}

export type ServiceStatus = 'off' | 'starting' | 'running' | 'error';

export interface EngineState {
  status: ServiceStatus;
  error: AppError | null;
  /** Estimated delay between singing and hearing yourself, in milliseconds. */
  monitoringLatencyMs: number | null;
}

export interface CameraState {
  status: ServiceStatus;
  error: AppError | null;
  /** Actual capture size once running (the camera may not support the requested one). */
  width: number;
  height: number;
}

export interface TrackingState {
  status: ServiceStatus;
  error: AppError | null;
}

export interface SongFile {
  name: string;
  path: string;
  durationSec: number;
}

export interface BackingState {
  status: 'none' | 'loading' | 'ready' | 'failed';
  file: SongFile | null;
  error: AppError | null;
}

export interface ReferenceState {
  /** 'analyzing' shows "Analyzing reference vocal…"; 'ready' shows "Reference melody ready". */
  status: 'none' | 'loading' | 'analyzing' | 'ready' | 'failed';
  file: SongFile | null;
  /** Analysis progress, 0..1. */
  progress: number;
  /** e.g. "A minor", once known. */
  keyLabel: string | null;
  /**
   * True when the melody is good enough to guide the autotune. When false the autotune
   * still follows the song's key.
   */
  melodyUsable: boolean;
  error: AppError | null;
}

export type RecordingStatus =
  | 'idle'
  | 'countdown'
  | 'recording'
  | 'paused'
  /** Stopping: flushing audio and video to disk. */
  | 'finishing'
  /** A finished take is waiting to be saved or discarded. */
  | 'review'
  | 'exporting'
  | 'saved';

export interface RecordingState {
  status: RecordingStatus;
  /** Whole seconds left while status is 'countdown'. */
  countdownRemaining: number;
  /** Length of the finished take (review / exporting / saved). */
  takeDurationSec: number;
  exportStage: ExportStage | null;
  /** 0..1 while exporting. */
  exportProgress: number;
  savedPath: string | null;
  /** Last recording or export failure. The take stays in 'review' so saving can be retried. */
  error: AppError | null;
}

export interface Notice {
  id: string;
  kind: 'error' | 'warning' | 'info' | 'success';
  message: string;
}

export interface StudioState {
  phase: AppPhase;
  appInfo: AppInfo | null;
  settings: Settings;
  devices: DevicesState;
  permissions: Record<MediaKind, PermissionStatus>;
  engine: EngineState;
  camera: CameraState;
  tracking: TrackingState;
  backing: BackingState;
  reference: ReferenceState;
  /** True while the backing track is being auditioned outside a recording. */
  previewPlaying: boolean;
  recording: RecordingState;
  /** Transient messages for the toast area, oldest first. */
  notices: Notice[];
}

/**
 * Values that change at display or audio rate. They are deliberately NOT React state: the
 * object is mutated in place and components read it inside animation-frame callbacks.
 */
export interface LiveReadouts {
  /** The effective control values right now (gesture or manual), 0..1 each. */
  controls: ControlValues;
  controlStatus: Record<ControlId, ControlStatus>;
  /** Latest interpreted hands, or null when tracking is off. */
  gesture: GestureFrame | null;
  /** Peak microphone level, 0..1. */
  inputLevel: number;
  /** Peak processed-vocal level, 0..1. */
  outputLevel: number;
  detectedMidi: number | null;
  targetMidi: number | null;
  /** Recording time so far, pauses excluded. */
  recordingElapsedSec: number;
  /** Backing-track position while it is playing, else null. */
  songPositionSec: number | null;
}

export interface StudioActions {
  /** Loads settings, permissions and devices, then enters the wizard or the studio. */
  initialize(): Promise<void>;

  /** Applies immediately, persists in the background, and pushes side effects to the engine. */
  updateSettings(patch: DeepPartial<Settings>): void;

  requestPermission(kind: MediaKind): Promise<PermissionStatus>;
  openPermissionSettings(kind: MediaKind): void;
  refreshDevices(): Promise<void>;
  selectMicrophone(deviceId: string | null): Promise<void>;
  selectCamera(deviceId: string | null): Promise<void>;
  selectOutput(deviceId: string | null): Promise<void>;
  /** Switches between Video and Audio Only (starts or stops the camera and hand tracking). */
  setMode(mode: RecordingMode): Promise<void>;

  /** Starts the microphone and live monitoring if they are not running. Errors land in state. */
  startAudio(): Promise<void>;
  startCamera(): Promise<void>;
  stopCamera(): void;
  /**
   * Hands the app the <video> element that shows the camera. The app sets its stream and
   * reads frames from it for hand tracking; the UI only styles it. Pass null on unmount.
   */
  attachPreview(element: HTMLVideoElement | null): void;
  playTestSound(): Promise<void>;
  /**
   * Samples the right hand for a moment and stores its size as the resting distance.
   * Resolves false when no hand was seen.
   */
  calibrateHandDistance(): Promise<boolean>;

  setControlSource(control: ControlId, source: ControlSource): void;
  setManualControl(control: ControlId, value: number): void;
  /** Keyboard control: moves a manual value by `delta` (e.g. ±0.05), clamped to 0..1. */
  nudgeManualControl(control: ControlId, delta: number): void;

  /** Opens the native file dialog, then loads the chosen file. */
  chooseBackingTrack(): Promise<void>;
  loadBackingTrack(path: string): Promise<void>;
  clearBackingTrack(): void;
  chooseReferenceSong(): Promise<void>;
  /** Loads the file and analyzes it (or restores the cached analysis). */
  loadReferenceSong(path: string): Promise<void>;
  clearReferenceSong(): void;
  /** Play/stop the backing track outside a recording. */
  togglePreviewPlayback(): void;

  completeOnboarding(): void;
  restartOnboarding(): void;

  /** idle → countdown (when enabled) → recording. */
  startRecording(): Promise<void>;
  /** recording ↔ paused. */
  togglePause(): void;
  /** recording/paused → finishing → review. */
  stopRecording(): Promise<void>;
  /** Abandons the countdown, the take in progress, or the take under review. */
  discardTake(): Promise<void>;
  /** review → native save dialog → exporting → saved. Cancelling the dialog stays in review. */
  saveTake(): Promise<void>;
  cancelExport(): void;
  openSavedFile(): void;
  showSavedInFolder(): void;
  /** saved → idle, ready for the next take. */
  recordAnother(): void;

  dismissNotice(id: string): void;
}

export interface Studio {
  store: StoreApi<StudioState>;
  actions: StudioActions;
  live: LiveReadouts;
}

/** Which controls are currently following a hand (video mode, tracking on, source = gesture). */
export function isGestureControlled(
  state: Pick<StudioState, 'settings' | 'camera' | 'tracking'>,
  control: ControlId,
): boolean {
  const { settings, camera, tracking } = state;
  return (
    settings.mode === 'video' &&
    settings.controls.handControlEnabled &&
    settings.controls[control].source === 'gesture' &&
    camera.status === 'running' &&
    tracking.status === 'running'
  );
}

export type { ControlSource, ControlStatus };
