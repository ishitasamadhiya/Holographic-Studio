// Turns the device lists in app state into choices for a Select, with "System default"
// (stored as null) always offered first.
import type { DeviceOption } from '@renderer/state/studioTypes';
import type { SelectOption } from '@renderer/ui';

export const SYSTEM_DEFAULT_LABEL = 'System default';

/**
 * Stands for "no specific device" inside a Select, whose values must be non-empty strings.
 * Chosen so that it can never be mistaken for a real device id.
 */
export const SYSTEM_DEFAULT_VALUE = '__system-default__';

export function deviceSelectOptions(devices: readonly DeviceOption[]): SelectOption[] {
  return [
    { value: SYSTEM_DEFAULT_VALUE, label: SYSTEM_DEFAULT_LABEL },
    ...devices.map((device) => ({ value: device.id, label: device.label })),
  ];
}

export function selectValueForDevice(deviceId: string | null): string {
  return deviceId ?? SYSTEM_DEFAULT_VALUE;
}

export function deviceIdForSelectValue(value: string): string | null {
  return value === SYSTEM_DEFAULT_VALUE ? null : value;
}

/** The name to show for the chosen device; a device that has gone away reads as the default. */
export function chosenDeviceLabel(
  devices: readonly DeviceOption[],
  deviceId: string | null,
): string {
  return devices.find((device) => device.id === deviceId)?.label ?? SYSTEM_DEFAULT_LABEL;
}
