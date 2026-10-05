import type { MediaKind, PermissionStatus } from '@shared/ipc';

/** The slice of Electron this service needs; injected so it can be tested without Electron. */
export interface MediaPermissionSystem {
  /** systemPreferences.getMediaAccessStatus */
  getMediaAccessStatus(kind: MediaKind): string;
  /** systemPreferences.askForMediaAccess */
  askForMediaAccess(kind: MediaKind): Promise<boolean>;
  /** shell.openExternal */
  openExternal(url: string): Promise<void>;
}

export interface MediaPermissionsOptions {
  platform: NodeJS.Platform;
  /** End-to-end tests use synthetic devices, which need no permission. */
  isE2E: boolean;
  system: MediaPermissionSystem;
}

const KNOWN_STATUSES: readonly PermissionStatus[] = [
  'granted',
  'denied',
  'not-determined',
  'restricted',
  'unknown',
];

const MACOS_PRIVACY_PANES: Record<MediaKind, string> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
};

const WINDOWS_PRIVACY_PAGES: Record<MediaKind, string> = {
  microphone: 'ms-settings:privacy-microphone',
  camera: 'ms-settings:privacy-webcam',
};

export function isMediaKind(value: unknown): value is MediaKind {
  return value === 'microphone' || value === 'camera';
}

/**
 * Operating-system permission for the microphone and camera. Only macOS has a per-app
 * permission that Electron can query and request; elsewhere access is reported as granted
 * and a real problem shows up when the device is opened.
 */
export class MediaPermissions {
  constructor(private readonly options: MediaPermissionsOptions) {}

  getStatus(kind: MediaKind): PermissionStatus {
    if (!this.usesSystemPermissions()) return 'granted';
    const status = this.options.system.getMediaAccessStatus(kind) as PermissionStatus;
    return KNOWN_STATUSES.includes(status) ? status : 'unknown';
  }

  /** Shows the macOS prompt if the user has never been asked; otherwise reports the status. */
  async request(kind: MediaKind): Promise<PermissionStatus> {
    const status = this.getStatus(kind);
    if (status !== 'not-determined') return status;
    const granted = await this.options.system.askForMediaAccess(kind);
    return granted ? 'granted' : 'denied';
  }

  /** Opens the system's privacy page for the device. Does nothing during automated tests. */
  async openSystemSettings(kind: MediaKind): Promise<void> {
    if (this.options.isE2E) return;
    const url = this.settingsUrl(kind);
    if (url) await this.options.system.openExternal(url);
  }

  private usesSystemPermissions(): boolean {
    return this.options.platform === 'darwin' && !this.options.isE2E;
  }

  private settingsUrl(kind: MediaKind): string | null {
    if (this.options.platform === 'darwin') return MACOS_PRIVACY_PANES[kind];
    if (this.options.platform === 'win32') return WINDOWS_PRIVACY_PAGES[kind];
    return null;
  }
}
