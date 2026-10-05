// Decides whether something is blocking the studio (no microphone, no camera) and what the
// singer can do about it. Audio comes first: without it nothing can be recorded at all.
import { FRIENDLY_ERROR_MESSAGES, type AppError } from '@shared/errors';
import type { MediaKind } from '@shared/ipc';
import type { RecordingMode } from '@shared/settings';
import type { CameraState, EngineState } from '@renderer/state/studioTypes';

export type ProblemAction = 'open-system-settings' | 'retry' | 'switch-to-audio';

export interface StudioProblem {
  /** Which device the problem is about; also what "Try again" restarts. */
  source: MediaKind;
  title: string;
  message: string;
  /** In display order; the first one is the suggested way out. */
  actions: ProblemAction[];
}

function audioTitle(error: AppError | null): string {
  switch (error?.code) {
    case 'microphone-permission-denied':
      return 'Microphone access is off';
    case 'no-microphone':
      return 'No microphone found';
    case 'device-disconnected':
      return 'A device was disconnected';
    default:
      return 'Sound could not start';
  }
}

function cameraTitle(error: AppError | null): string {
  switch (error?.code) {
    case 'camera-permission-denied':
      return 'Camera access is off';
    case 'no-camera':
      return 'No camera found';
    case 'device-disconnected':
      return 'The camera was disconnected';
    default:
      return 'The camera could not start';
  }
}

export function findStudioProblem(
  engine: EngineState,
  camera: CameraState,
  mode: RecordingMode,
): StudioProblem | null {
  if (engine.status === 'error') {
    const needsPermission = engine.error?.code === 'microphone-permission-denied';
    return {
      source: 'microphone',
      title: audioTitle(engine.error),
      message: engine.error?.message ?? FRIENDLY_ERROR_MESSAGES['audio-engine-failed'],
      actions: needsPermission ? ['open-system-settings', 'retry'] : ['retry'],
    };
  }

  // In Audio Only the camera is not needed, so its trouble is not the singer's problem.
  if (mode === 'video' && camera.status === 'error') {
    const needsPermission = camera.error?.code === 'camera-permission-denied';
    return {
      source: 'camera',
      title: cameraTitle(camera.error),
      message: camera.error?.message ?? FRIENDLY_ERROR_MESSAGES['no-camera'],
      actions: needsPermission
        ? ['open-system-settings', 'retry', 'switch-to-audio']
        : ['retry', 'switch-to-audio'],
    };
  }

  return null;
}

/** Whether a new take can start: live audio is running and nothing above is in the way. */
export function canStartRecording(
  engine: EngineState,
  camera: CameraState,
  mode: RecordingMode,
): boolean {
  return engine.status === 'running' && !(mode === 'video' && camera.status === 'error');
}
