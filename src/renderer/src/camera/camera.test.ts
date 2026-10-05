import { describe, expect, it } from 'vitest';
import { cameraConstraintLadder } from './cameraConstraints';
import { cameraErrorFrom, isMissingDevice, isUnsupportedConstraint } from './cameraErrors';

function domError(name: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(name), { name, ...extra });
}

describe('camera constraints', () => {
  it('asks for 1080p, then 720p, then whatever the chosen camera offers, at 30 fps', () => {
    const ladder = cameraConstraintLadder('cam-1', '1080p');
    expect(ladder).toEqual([
      {
        deviceId: { exact: 'cam-1' },
        frameRate: { ideal: 30 },
        width: { exact: 1920 },
        height: { exact: 1080 },
      },
      {
        deviceId: { exact: 'cam-1' },
        frameRate: { ideal: 30 },
        width: { exact: 1280 },
        height: { exact: 720 },
      },
      { deviceId: { exact: 'cam-1' }, frameRate: { ideal: 30 } },
    ]);
  });

  it('leaves the device open for the system default and skips 1080p when 720p is chosen', () => {
    const ladder = cameraConstraintLadder(null, '720p');
    expect(ladder).toHaveLength(2);
    expect(ladder[0]).not.toHaveProperty('deviceId');
    expect(ladder[0]?.width).toEqual({ exact: 1280 });
  });
});

describe('camera errors', () => {
  it('tells an unsupported size from a missing camera', () => {
    const size = domError('OverconstrainedError', { constraint: 'width' });
    const device = domError('OverconstrainedError', { constraint: 'deviceId' });
    expect(isUnsupportedConstraint(size)).toBe(true);
    expect(isMissingDevice(size)).toBe(false);
    expect(isUnsupportedConstraint(device)).toBe(false);
    expect(isMissingDevice(device)).toBe(true);
    expect(isMissingDevice(domError('NotFoundError'))).toBe(true);
  });

  it('maps failures to friendly errors', () => {
    expect(cameraErrorFrom(domError('NotAllowedError')).code).toBe('camera-permission-denied');
    expect(cameraErrorFrom(domError('NotFoundError')).code).toBe('no-camera');
    const busy = cameraErrorFrom(domError('NotReadableError'));
    expect(busy.code).toBe('unknown');
    expect(busy.message).toContain('Close other apps');
    expect(busy.detail).toContain('NotReadableError');
  });
});
