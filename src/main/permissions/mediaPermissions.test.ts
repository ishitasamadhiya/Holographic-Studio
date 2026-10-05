import { describe, expect, it } from 'vitest';
import type { MediaKind } from '@shared/ipc';
import { isMediaKind, MediaPermissions, type MediaPermissionSystem } from './mediaPermissions';

interface FakeSystem extends MediaPermissionSystem {
  statuses: Record<MediaKind, string>;
  answerPrompt: boolean;
  prompts: MediaKind[];
  openedUrls: string[];
}

function fakeSystem(statuses: Partial<Record<MediaKind, string>> = {}): FakeSystem {
  const system: FakeSystem = {
    statuses: { microphone: 'not-determined', camera: 'not-determined', ...statuses },
    answerPrompt: true,
    prompts: [],
    openedUrls: [],
    getMediaAccessStatus: (kind) => system.statuses[kind],
    askForMediaAccess: async (kind) => {
      system.prompts.push(kind);
      system.statuses[kind] = system.answerPrompt ? 'granted' : 'denied';
      return system.answerPrompt;
    },
    openExternal: async (url) => {
      system.openedUrls.push(url);
    },
  };
  return system;
}

function permissions(
  system: FakeSystem,
  platform: NodeJS.Platform = 'darwin',
  isE2E = false,
): MediaPermissions {
  return new MediaPermissions({ platform, isE2E, system });
}

describe('MediaPermissions on macOS', () => {
  it('reports the system status for each device', () => {
    const service = permissions(fakeSystem({ microphone: 'granted', camera: 'denied' }));
    expect(service.getStatus('microphone')).toBe('granted');
    expect(service.getStatus('camera')).toBe('denied');
  });

  it('maps an unexpected status string to "unknown"', () => {
    expect(permissions(fakeSystem({ camera: 'maybe' })).getStatus('camera')).toBe('unknown');
  });

  it('prompts when the user has never been asked, and reports the answer', async () => {
    const system = fakeSystem();
    const service = permissions(system);
    expect(await service.request('microphone')).toBe('granted');
    expect(system.prompts).toEqual(['microphone']);
    expect(service.getStatus('microphone')).toBe('granted');

    system.answerPrompt = false;
    expect(await service.request('camera')).toBe('denied');
    expect(system.prompts).toEqual(['microphone', 'camera']);
  });

  it.each(['granted', 'denied', 'restricted'])(
    'does not prompt again when the status is already %s',
    async (status) => {
      const system = fakeSystem({ camera: status });
      expect(await permissions(system).request('camera')).toBe(status);
      expect(system.prompts).toEqual([]);
    },
  );

  it('opens the matching Privacy pane of System Settings', async () => {
    const system = fakeSystem();
    const service = permissions(system);
    await service.openSystemSettings('microphone');
    await service.openSystemSettings('camera');
    expect(system.openedUrls).toEqual([
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
    ]);
  });
});

describe('MediaPermissions elsewhere', () => {
  it('reports granted on other platforms without asking the system', async () => {
    const system = fakeSystem({ microphone: 'denied', camera: 'denied' });
    for (const platform of ['win32', 'linux'] as const) {
      const service = permissions(system, platform);
      expect(service.getStatus('microphone')).toBe('granted');
      expect(await service.request('camera')).toBe('granted');
    }
    expect(system.prompts).toEqual([]);
  });

  it('opens the Windows privacy pages on Windows and nothing on Linux', async () => {
    const system = fakeSystem();
    await permissions(system, 'win32').openSystemSettings('microphone');
    await permissions(system, 'win32').openSystemSettings('camera');
    await permissions(system, 'linux').openSystemSettings('camera');
    expect(system.openedUrls).toEqual([
      'ms-settings:privacy-microphone',
      'ms-settings:privacy-webcam',
    ]);
  });

  it('is always granted in end-to-end tests and never opens System Settings', async () => {
    const system = fakeSystem({ microphone: 'denied', camera: 'not-determined' });
    const service = permissions(system, 'darwin', true);
    expect(service.getStatus('microphone')).toBe('granted');
    expect(await service.request('camera')).toBe('granted');
    await service.openSystemSettings('camera');
    expect(system.prompts).toEqual([]);
    expect(system.openedUrls).toEqual([]);
  });
});

describe('isMediaKind', () => {
  it('accepts only the two device kinds', () => {
    expect(isMediaKind('microphone')).toBe(true);
    expect(isMediaKind('camera')).toBe(true);
    expect(isMediaKind('screen')).toBe(false);
    expect(isMediaKind(undefined)).toBe(false);
  });
});
