// One friendly error vocabulary for the whole app. Technical detail is kept for logs only.

export type AppErrorCode =
  | 'microphone-permission-denied'
  | 'camera-permission-denied'
  | 'no-microphone'
  | 'no-camera'
  | 'device-disconnected'
  | 'audio-engine-failed'
  | 'hand-tracking-failed'
  | 'unsupported-audio-file'
  | 'file-read-failed'
  | 'analysis-failed'
  | 'recording-failed'
  | 'export-failed'
  | 'export-cancelled'
  | 'output-folder-unavailable'
  | 'unknown';

export interface AppError {
  code: AppErrorCode;
  /** Plain-language sentence that is safe to show to a singer. */
  message: string;
  /** Technical detail for logs and bug reports. Never shown by default. */
  detail?: string;
}

export const FRIENDLY_ERROR_MESSAGES: Record<AppErrorCode, string> = {
  'microphone-permission-denied':
    'Holographic Studio is not allowed to use the microphone. Turn it on in System Settings → Privacy & Security → Microphone, then try again.',
  'camera-permission-denied':
    'Holographic Studio is not allowed to use the camera. Turn it on in System Settings → Privacy & Security → Camera, or switch to Audio Only.',
  'no-microphone': 'No microphone was found. Plug one in or check your sound settings.',
  'no-camera': 'No camera was found. You can still record in Audio Only mode.',
  'device-disconnected':
    'A device was disconnected. Reconnect it or pick a different one in Settings.',
  'audio-engine-failed':
    'The audio engine could not start. Check your sound devices and try again.',
  'hand-tracking-failed':
    'Hand tracking could not start. You can keep going with the manual sliders.',
  'unsupported-audio-file': 'That file could not be opened. Try an MP3, WAV, or M4A file.',
  'file-read-failed': 'That file could not be read. It may have been moved or deleted.',
  'analysis-failed':
    'The reference song could not be analyzed. Autotune will follow the nearest note instead.',
  'recording-failed': 'Something went wrong while recording. Please try another take.',
  'export-failed': 'The video could not be saved. Your take is still here — try saving again.',
  'export-cancelled': 'Saving was cancelled.',
  'output-folder-unavailable':
    'That folder is not available. Choose a different place to save your video.',
  unknown: 'Something unexpected happened. Please try again.',
};

export function createAppError(code: AppErrorCode, detail?: unknown): AppError {
  const error: AppError = { code, message: FRIENDLY_ERROR_MESSAGES[code] };
  if (detail !== undefined) {
    error.detail = detail instanceof Error ? `${detail.name}: ${detail.message}` : String(detail);
  }
  return error;
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AppError).code === 'string' &&
    (value as AppError).code in FRIENDLY_ERROR_MESSAGES &&
    typeof (value as AppError).message === 'string'
  );
}

/** Result envelope used wherever a failure is an expected, user-facing outcome. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(code: AppErrorCode, detail?: unknown): Result<T> {
  return { ok: false, error: createAppError(code, detail) };
}
