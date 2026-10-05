// Turns the browser's raw device list into the three lists the UI offers.
import type { DeviceInfoLike } from '@renderer/camera/mediaDevices';
import type { DeviceOption } from '@renderer/state/studioTypes';

export type DeviceGroup = 'microphones' | 'cameras' | 'outputs';

export interface DeviceCatalog {
  microphones: DeviceOption[];
  cameras: DeviceOption[];
  outputs: DeviceOption[];
  /**
   * Per list: true when the browser revealed device names. It only does that once access
   * has been granted, and only then is the list known to be the full set of real devices.
   */
  complete: Record<DeviceGroup, boolean>;
}

const GROUP_OF_KIND: Record<MediaDeviceKind, DeviceGroup> = {
  audioinput: 'microphones',
  videoinput: 'cameras',
  audiooutput: 'outputs',
};

/** Used when a device has no name of its own. */
const GENERIC_NAME: Record<DeviceGroup, string> = {
  microphones: 'Microphone',
  cameras: 'Camera',
  outputs: 'Speaker',
};

/**
 * Chromium lists "default" and "communications" as if they were devices. They are aliases
 * of real ones further down the list; the UI offers "System default" itself.
 */
const ALIAS_DEVICE_IDS = new Set(['default', 'communications']);

export function catalogDevices(infos: readonly DeviceInfoLike[]): DeviceCatalog {
  const catalog: DeviceCatalog = {
    microphones: [],
    cameras: [],
    outputs: [],
    complete: { microphones: false, cameras: false, outputs: false },
  };
  for (const info of infos) {
    const group = GROUP_OF_KIND[info.kind];
    if (info.label !== '') catalog.complete[group] = true;
    // Before access is granted every device is reported with an empty id.
    if (info.deviceId === '' || ALIAS_DEVICE_IDS.has(info.deviceId)) continue;
    const options = catalog[group];
    if (options.some((option) => option.id === info.deviceId)) continue;
    options.push({
      id: info.deviceId,
      label: info.label || `${GENERIC_NAME[group]} ${options.length + 1}`,
    });
  }
  return catalog;
}

/** True when a remembered device is known to be gone (never true while the list is partial). */
export function isSelectionMissing(
  selectedId: string | null,
  catalog: DeviceCatalog,
  group: DeviceGroup,
): boolean {
  if (selectedId === null || !catalog.complete[group]) return false;
  return !catalog[group].some((option) => option.id === selectedId);
}
