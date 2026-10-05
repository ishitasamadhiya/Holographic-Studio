// Structural validation of the take descriptions the UI sends (and of manifests read back
// from disk). Nothing downstream has to re-check ranges once a value has passed through here.
import type { RecordingMode } from '@shared/settings';
import type { TakeInit, TakeManifest } from '@shared/take';
import { videoExtensionForMimeType } from './takeFiles';

const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 192_000;
const MAX_VOCAL_LATENCY_SEC = 5;
const MAX_VIDEO_START_OFFSET_SEC = 3600;
const MAX_VIDEO_DURATION_SEC = 6 * 3600;
const MAX_VIDEO_DIMENSION = 8192;
const MAX_FRAME_RATE = 240;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isRecordingMode(value: unknown): value is RecordingMode {
  return value === 'video' || value === 'audio';
}

function isVideoSize(width: unknown, height: unknown): boolean {
  return (
    isIntegerBetween(width, 1, MAX_VIDEO_DIMENSION) &&
    isIntegerBetween(height, 1, MAX_VIDEO_DIMENSION)
  );
}

function isFrameRate(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0 && value <= MAX_FRAME_RATE;
}

/** Returns a clean copy of a valid TakeInit, or null. An audio take's video block is dropped. */
export function parseTakeInit(value: unknown): TakeInit | null {
  const init = asRecord(value);
  if (!init || !isRecordingMode(init.mode)) return null;
  if (!isIntegerBetween(init.sampleRate, MIN_SAMPLE_RATE, MAX_SAMPLE_RATE)) return null;
  if (init.mode === 'audio') return { mode: 'audio', sampleRate: init.sampleRate };

  const video = asRecord(init.video);
  if (!video || typeof video.mimeType !== 'string') return null;
  if (videoExtensionForMimeType(video.mimeType) === null) return null;
  if (!isVideoSize(video.width, video.height) || !isFrameRate(video.frameRate)) return null;
  return {
    mode: 'video',
    sampleRate: init.sampleRate,
    video: {
      mimeType: video.mimeType,
      width: video.width as number,
      height: video.height as number,
      frameRate: video.frameRate,
    },
  };
}

function parseVideoTiming(value: unknown): TakeManifest['video'] | null {
  const video = asRecord(value);
  if (!video) return null;
  const { startOffsetSec, durationSec, width, height, frameRate } = video;
  if (!isFiniteNumber(startOffsetSec) || Math.abs(startOffsetSec) > MAX_VIDEO_START_OFFSET_SEC) {
    return null;
  }
  if (!isFiniteNumber(durationSec) || durationSec <= 0 || durationSec > MAX_VIDEO_DURATION_SEC) {
    return null;
  }
  if (!isVideoSize(width, height) || !isFrameRate(frameRate)) return null;
  return {
    startOffsetSec,
    durationSec,
    width: width as number,
    height: height as number,
    frameRate,
  };
}

/** The diagnostics are informational, so a malformed block is dropped rather than fatal. */
function parseDiagnostics(value: unknown): TakeManifest['diagnostics'] | undefined {
  const diagnostics = asRecord(value);
  if (!diagnostics) return undefined;
  const { inputLatencySec, outputLatencySec, processingLatencySec, cameraLatencySec, pauses } =
    diagnostics;
  if (
    !isFiniteNumber(inputLatencySec) ||
    !isFiniteNumber(outputLatencySec) ||
    !isFiniteNumber(processingLatencySec) ||
    !isFiniteNumber(pauses)
  ) {
    return undefined;
  }
  return {
    inputLatencySec,
    outputLatencySec,
    processingLatencySec,
    pauses,
    ...(isFiniteNumber(cameraLatencySec) ? { cameraLatencySec } : {}),
  };
}

/** Returns a clean copy of a valid TakeManifest, or null. */
export function parseTakeManifest(value: unknown): TakeManifest | null {
  const manifest = asRecord(value);
  if (!manifest || !isRecordingMode(manifest.mode)) return null;
  if (!isIntegerBetween(manifest.sampleRate, MIN_SAMPLE_RATE, MAX_SAMPLE_RATE)) return null;
  if (!isIntegerBetween(manifest.audioFrames, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (
    !isFiniteNumber(manifest.vocalLatencySec) ||
    Math.abs(manifest.vocalLatencySec) > MAX_VOCAL_LATENCY_SEC
  ) {
    return null;
  }
  if (typeof manifest.hasBacking !== 'boolean') return null;

  const parsed: TakeManifest = {
    mode: manifest.mode,
    sampleRate: manifest.sampleRate,
    audioFrames: manifest.audioFrames,
    vocalLatencySec: manifest.vocalLatencySec,
    hasBacking: manifest.hasBacking,
  };
  if (manifest.mode === 'video') {
    const video = parseVideoTiming(manifest.video);
    if (!video) return null;
    parsed.video = video;
  }
  const diagnostics = parseDiagnostics(manifest.diagnostics);
  if (diagnostics) parsed.diagnostics = diagnostics;
  return parsed;
}
