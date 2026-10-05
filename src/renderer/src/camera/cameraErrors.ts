// Translates getUserMedia failures into the app's friendly errors.
import { createAppError, type AppError } from '@shared/errors';

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
}

/** The camera exists but cannot satisfy the size (or other property) that was asked for. */
export function isUnsupportedConstraint(error: unknown): boolean {
  return errorName(error) === 'OverconstrainedError' && !isMissingDevice(error);
}

/** The specific camera that was asked for is not there (any more). */
export function isMissingDevice(error: unknown): boolean {
  if (errorName(error) === 'NotFoundError') return true;
  return (
    errorName(error) === 'OverconstrainedError' &&
    typeof error === 'object' &&
    error !== null &&
    'constraint' in error &&
    error.constraint === 'deviceId'
  );
}

/**
 * Shown when a camera is present but will not start, typically because another app is
 * using it. The shared error vocabulary has no dedicated code for this, so it travels as
 * 'unknown' with its own wording.
 */
export const CAMERA_BUSY_MESSAGE =
  'The camera could not be started. Close other apps that may be using it, or switch to Audio Only.';

export function cameraErrorFrom(error: unknown): AppError {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return createAppError('camera-permission-denied', error);
    case 'NotFoundError':
    case 'OverconstrainedError':
      return createAppError('no-camera', error);
    default:
      return { ...createAppError('unknown', error), message: CAMERA_BUSY_MESSAGE };
  }
}
