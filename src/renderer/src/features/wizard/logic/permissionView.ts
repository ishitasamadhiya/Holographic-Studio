import { FRIENDLY_ERROR_MESSAGES, type AppError } from '@shared/errors';
import type { MediaKind, PermissionStatus } from '@shared/ipc';

export type PermissionView =
  /** Never asked: the wizard explains why and offers to ask. */
  | 'ask'
  /** Refused, or not ours to ask for: only System Settings can change it. */
  | 'blocked'
  /** Good to go. */
  | 'allowed';

/**
 * What the wizard shows for a system permission. 'unknown' counts as allowed: there is
 * nothing to ask for in that case, and a real problem surfaces as a friendly error when
 * the device is opened.
 */
export function permissionView(status: PermissionStatus): PermissionView {
  switch (status) {
    case 'not-determined':
      return 'ask';
    case 'denied':
    case 'restricted':
      return 'blocked';
    case 'granted':
    case 'unknown':
      return 'allowed';
  }
}

const DENIED_CODES = {
  microphone: 'microphone-permission-denied',
  camera: 'camera-permission-denied',
} as const;

/**
 * The sentence shown while a permission is blocked: the app's own error when it reported
 * this very problem, otherwise the standard wording for it.
 */
export function blockedPermissionMessage(kind: MediaKind, reported: AppError | null): string {
  const code = DENIED_CODES[kind];
  return reported?.code === code ? reported.message : FRIENDLY_ERROR_MESSAGES[code];
}
