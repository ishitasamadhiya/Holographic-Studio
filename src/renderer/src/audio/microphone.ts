// Opening the microphone the way live vocals need it: raw (no echo cancellation, noise
// suppression or automatic gain — they add latency and fight the effects), mono, low latency.
import {
  createAppError,
  fail,
  ok,
  type AppError,
  type AppErrorCode,
  type Result,
} from '@shared/errors';
import { DEFAULT_INPUT_LATENCY_SEC } from './engineConstants';

/** The part of navigator.mediaDevices the engine uses; injectable for tests. */
export interface MicrophoneAccess {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

/** `latency` is implemented by Chromium but missing from TypeScript's DOM typings. */
type AudioTrackConstraints = MediaTrackConstraints & { latency?: ConstrainDouble };
type AudioTrackSettings = MediaTrackSettings & { latency?: number };

export function microphoneConstraints(deviceId: string | null): MediaStreamConstraints {
  const audio: AudioTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 1 },
    latency: { ideal: 0 },
  };
  if (deviceId !== null) audio.deviceId = { exact: deviceId };
  return { audio, video: false };
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
}

/** Which friendly error a failed getUserMedia call stands for. */
export function microphoneErrorCode(error: unknown): AppErrorCode {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'microphone-permission-denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'no-microphone';
    default:
      return 'audio-engine-failed';
  }
}

export function microphoneError(error: unknown): AppError {
  return createAppError(microphoneErrorCode(error), error);
}

/** True when the failure means "that particular device is not there" rather than "no access". */
function isMissingDevice(error: unknown): boolean {
  const name = errorName(error);
  return (
    name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'DevicesNotFoundError'
  );
}

/**
 * Opens the given microphone (null = system default). A device id that no longer exists —
 * typically one remembered from an earlier session — falls back to the default microphone.
 */
export async function openMicrophone(
  access: MicrophoneAccess | undefined,
  deviceId: string | null,
): Promise<Result<MediaStream>> {
  if (!access) return fail('audio-engine-failed', 'navigator.mediaDevices is unavailable');
  try {
    return ok(await access.getUserMedia(microphoneConstraints(deviceId)));
  } catch (error) {
    if (deviceId === null || !isMissingDevice(error))
      return { ok: false, error: microphoneError(error) };
  }
  try {
    return ok(await access.getUserMedia(microphoneConstraints(null)));
  } catch (error) {
    // With no device named, "nothing satisfies the constraints" means there is no microphone.
    const code = isMissingDevice(error) ? 'no-microphone' : microphoneErrorCode(error);
    return fail(code, error);
  }
}

/** Capture delay of a microphone track: what the track reports, else a typical value. */
export function microphoneLatencySec(settings: MediaTrackSettings | undefined): number {
  const reported = (settings as AudioTrackSettings | undefined)?.latency;
  return typeof reported === 'number' && Number.isFinite(reported) && reported > 0
    ? reported
    : DEFAULT_INPUT_LATENCY_SEC;
}
