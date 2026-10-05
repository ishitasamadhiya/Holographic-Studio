// Validation for persisted settings. Anything read from disk or sent by the UI goes through
// normalizeSettings, so the rest of the app can trust every field of a Settings value.
import type { ControlSource } from './controls';
import {
  SETTINGS_VERSION,
  DEFAULT_SETTINGS,
  VIDEO_RESOLUTIONS,
  type ControlSetting,
  type DeepPartial,
  type RecordingMode,
  type Settings,
  type VideoResolution,
} from './settings';

export interface NumberRange {
  min: number;
  max: number;
}

/** Valid ranges of the numeric settings. The UI can use the same limits for its sliders. */
export const SETTINGS_RANGES = {
  micGain: { min: 0, max: 2 },
  monitorVolume: { min: 0, max: 1 },
  backingVolume: { min: 0, max: 1 },
  controlValue: { min: 0, max: 1 },
  countdownSec: { min: 1, max: 10 },
  syncOffsetMs: { min: -1000, max: 1000 },
} as const satisfies Record<string, NumberRange>;

const MAX_DEVICE_ID_LENGTH = 512;
const MAX_PATH_LENGTH = 4096;

const RECORDING_MODES: readonly RecordingMode[] = ['video', 'audio'];
const CONTROL_SOURCES: readonly ControlSource[] = ['gesture', 'manual'];
const RESOLUTIONS = Object.keys(VIDEO_RESOLUTIONS) as VideoResolution[];

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown, range: NumberRange, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, value));
}

function readOneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** null is a real value here ("use the default device", "nothing remembered"). */
function readNullableText(
  value: unknown,
  maxLength: number,
  fallback: string | null,
): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) return fallback;
  return value.length > 0 ? value : null;
}

function readNullablePositive(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readControl(value: unknown, fallback: ControlSetting): ControlSetting {
  const control = asRecord(value);
  return {
    source: readOneOf(control.source, CONTROL_SOURCES, fallback.source),
    manual: readNumber(control.manual, SETTINGS_RANGES.controlValue, fallback.manual),
  };
}

/**
 * Builds a complete, valid Settings value from untrusted input. Every field is checked on
 * its own: a value of the wrong type falls back to `fallback`, numbers are clamped to their
 * range, and unknown fields are dropped. The stored version number is deliberately ignored,
 * so a file written by an older or newer build keeps every field this build still understands.
 */
export function normalizeSettings(raw: unknown, fallback: Settings = DEFAULT_SETTINGS): Settings {
  const root = asRecord(raw);
  const devices = asRecord(root.devices);
  const video = asRecord(root.video);
  const audio = asRecord(root.audio);
  const controls = asRecord(root.controls);
  const recording = asRecord(root.recording);
  const calibration = asRecord(root.calibration);
  const sync = asRecord(root.sync);
  const developer = asRecord(root.developer);
  const lastSession = asRecord(root.lastSession);

  return {
    version: SETTINGS_VERSION,
    onboardingComplete: readBoolean(root.onboardingComplete, fallback.onboardingComplete),
    mode: readOneOf(root.mode, RECORDING_MODES, fallback.mode),
    devices: {
      microphoneId: readNullableText(
        devices.microphoneId,
        MAX_DEVICE_ID_LENGTH,
        fallback.devices.microphoneId,
      ),
      cameraId: readNullableText(devices.cameraId, MAX_DEVICE_ID_LENGTH, fallback.devices.cameraId),
      outputId: readNullableText(devices.outputId, MAX_DEVICE_ID_LENGTH, fallback.devices.outputId),
    },
    video: {
      resolution: readOneOf(video.resolution, RESOLUTIONS, fallback.video.resolution),
    },
    audio: {
      monitoringEnabled: readBoolean(audio.monitoringEnabled, fallback.audio.monitoringEnabled),
      micGain: readNumber(audio.micGain, SETTINGS_RANGES.micGain, fallback.audio.micGain),
      monitorVolume: readNumber(
        audio.monitorVolume,
        SETTINGS_RANGES.monitorVolume,
        fallback.audio.monitorVolume,
      ),
      backingVolume: readNumber(
        audio.backingVolume,
        SETTINGS_RANGES.backingVolume,
        fallback.audio.backingVolume,
      ),
      reverbEnabled: readBoolean(audio.reverbEnabled, fallback.audio.reverbEnabled),
    },
    controls: {
      handControlEnabled: readBoolean(
        controls.handControlEnabled,
        fallback.controls.handControlEnabled,
      ),
      autotune: readControl(controls.autotune, fallback.controls.autotune),
      echo: readControl(controls.echo, fallback.controls.echo),
      volume: readControl(controls.volume, fallback.controls.volume),
      extraGesturesEnabled: readBoolean(
        controls.extraGesturesEnabled,
        fallback.controls.extraGesturesEnabled,
      ),
    },
    recording: {
      countdownEnabled: readBoolean(
        recording.countdownEnabled,
        fallback.recording.countdownEnabled,
      ),
      countdownSec: Math.round(
        readNumber(
          recording.countdownSec,
          SETTINGS_RANGES.countdownSec,
          fallback.recording.countdownSec,
        ),
      ),
    },
    calibration: {
      neutralHandScale: readNullablePositive(
        calibration.neutralHandScale,
        fallback.calibration.neutralHandScale,
      ),
    },
    sync: {
      vocalOffsetMs: readNumber(
        sync.vocalOffsetMs,
        SETTINGS_RANGES.syncOffsetMs,
        fallback.sync.vocalOffsetMs,
      ),
      videoOffsetMs: readNumber(
        sync.videoOffsetMs,
        SETTINGS_RANGES.syncOffsetMs,
        fallback.sync.videoOffsetMs,
      ),
    },
    developer: {
      showLandmarks: readBoolean(developer.showLandmarks, fallback.developer.showLandmarks),
    },
    lastSaveDir: readNullableText(root.lastSaveDir, MAX_PATH_LENGTH, fallback.lastSaveDir),
    lastSession: {
      backingPath: readNullableText(
        lastSession.backingPath,
        MAX_PATH_LENGTH,
        fallback.lastSession.backingPath,
      ),
      referencePath: readNullableText(
        lastSession.referencePath,
        MAX_PATH_LENGTH,
        fallback.lastSession.referencePath,
      ),
    },
  };
}

/**
 * Applies a partial update on top of `base`. Fields missing from the patch, and fields whose
 * patched value is invalid, keep their value from `base`; out-of-range numbers are clamped.
 * Never mutates its arguments.
 */
export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  return normalizeSettings(patch, base);
}
