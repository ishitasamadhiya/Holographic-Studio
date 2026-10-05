import { describe, expect, it } from 'vitest';
import { createAppError } from '@shared/errors';
import { blockedPermissionMessage, permissionView } from './permissionView';

describe('permissionView', () => {
  it('offers to ask only when the singer has never been asked', () => {
    expect(permissionView('not-determined')).toBe('ask');
  });

  it('sends the singer to System Settings when asking again cannot help', () => {
    expect(permissionView('denied')).toBe('blocked');
    expect(permissionView('restricted')).toBe('blocked');
  });

  it('carries on when access is granted or cannot be queried', () => {
    expect(permissionView('granted')).toBe('allowed');
    expect(permissionView('unknown')).toBe('allowed');
  });
});

describe('blockedPermissionMessage', () => {
  it('uses the message the app reported for this permission', () => {
    const reported = { ...createAppError('camera-permission-denied'), message: 'Camera is off.' };
    expect(blockedPermissionMessage('camera', reported)).toBe('Camera is off.');
  });

  it('falls back to the standard wording when nothing was reported', () => {
    expect(blockedPermissionMessage('microphone', null)).toContain(
      'Privacy & Security → Microphone',
    );
    expect(blockedPermissionMessage('camera', null)).toContain('switch to Audio Only');
  });

  it('ignores an unrelated error left in state', () => {
    const unrelated = createAppError('audio-engine-failed');
    expect(blockedPermissionMessage('microphone', unrelated)).toContain(
      'not allowed to use the microphone',
    );
  });
});
