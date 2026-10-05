import type { ControlSource } from './controls';

export const SETTINGS_VERSION = 1;

export type RecordingMode = 'video' | 'audio';
export type VideoResolution = '720p' | '1080p';

export const VIDEO_RESOLUTIONS: Record<VideoResolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

export interface ControlSetting {
  /** 'gesture' follows the hand when tracking is available; 'manual' always uses the slider. */
  source: ControlSource;
  /** Slider value, 0..1. Also the value a gesture control settles to when the hand is lost. */
  manual: number;
}

/** Everything remembered between sessions. Persisted as JSON by the main process. */
export interface Settings {
  version: typeof SETTINGS_VERSION;
  /** False until the first-run wizard has been completed once. */
  onboardingComplete: boolean;
  mode: RecordingMode;
  devices: {
    /** null = system default. */
    microphoneId: string | null;
    cameraId: string | null;
    outputId: string | null;
  };
  video: {
    resolution: VideoResolution;
  };
  audio: {
    /** Hear your own processed voice in the headphones. */
    monitoringEnabled: boolean;
    /** Microphone input trim, linear 0..2 (1 = unchanged). Affects the recording. */
    micGain: number;
    /** How loud your own voice is in the headphones, 0..1. Does not affect the recording. */
    monitorVolume: number;
    /** Backing track level, 0..1. Heard and recorded. */
    backingVolume: number;
    /** Light reverb on the vocal. */
    reverbEnabled: boolean;
  };
  controls: {
    /** Master switch for hand control. When false every control uses its slider. */
    handControlEnabled: boolean;
    autotune: ControlSetting;
    echo: ControlSetting;
    volume: ControlSetting;
    /** Optional extra gestures (off by default so they can never surprise a performer). */
    extraGesturesEnabled: boolean;
  };
  recording: {
    countdownEnabled: boolean;
    countdownSec: number;
  };
  calibration: {
    /** Hand size (see gestures module) at the performer's resting distance. null = default. */
    neutralHandScale: number | null;
  };
  /** Fine-tuning for export alignment, in milliseconds. Positive = later. */
  sync: {
    vocalOffsetMs: number;
    videoOffsetMs: number;
  };
  developer: {
    showLandmarks: boolean;
  };
  lastSaveDir: string | null;
  lastSession: {
    backingPath: string | null;
    referencePath: string | null;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  onboardingComplete: false,
  mode: 'video',
  devices: { microphoneId: null, cameraId: null, outputId: null },
  video: { resolution: '1080p' },
  audio: {
    monitoringEnabled: true,
    micGain: 1,
    monitorVolume: 1,
    backingVolume: 0.8,
    reverbEnabled: false,
  },
  controls: {
    handControlEnabled: true,
    autotune: { source: 'gesture', manual: 0.5 },
    echo: { source: 'gesture', manual: 0 },
    volume: { source: 'gesture', manual: 0.5 },
    extraGesturesEnabled: false,
  },
  recording: { countdownEnabled: true, countdownSec: 3 },
  calibration: { neutralHandScale: null },
  sync: { vocalOffsetMs: 0, videoOffsetMs: 0 },
  developer: { showLandmarks: false },
  lastSaveDir: null,
  lastSession: { backingPath: null, referencePath: null },
};

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
