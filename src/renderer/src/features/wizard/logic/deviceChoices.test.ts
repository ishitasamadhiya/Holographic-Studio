import { describe, expect, it } from 'vitest';
import {
  chosenDeviceLabel,
  deviceIdForSelectValue,
  deviceSelectOptions,
  selectValueForDevice,
  SYSTEM_DEFAULT_LABEL,
  SYSTEM_DEFAULT_VALUE,
} from './deviceChoices';

const microphones = [
  { id: 'built-in', label: 'MacBook Pro Microphone' },
  { id: 'usb', label: 'Scarlett Solo USB' },
];

describe('device choices', () => {
  it('offers "System default" first, then every device in order', () => {
    expect(deviceSelectOptions(microphones)).toEqual([
      { value: SYSTEM_DEFAULT_VALUE, label: 'System default' },
      { value: 'built-in', label: 'MacBook Pro Microphone' },
      { value: 'usb', label: 'Scarlett Solo USB' },
    ]);
  });

  it('still offers "System default" when no device is listed', () => {
    expect(deviceSelectOptions([])).toEqual([
      { value: SYSTEM_DEFAULT_VALUE, label: SYSTEM_DEFAULT_LABEL },
    ]);
  });

  it('maps the stored device id to a select value and back', () => {
    expect(selectValueForDevice(null)).toBe(SYSTEM_DEFAULT_VALUE);
    expect(selectValueForDevice('usb')).toBe('usb');
    expect(deviceIdForSelectValue(SYSTEM_DEFAULT_VALUE)).toBeNull();
    expect(deviceIdForSelectValue('usb')).toBe('usb');
    for (const id of [null, 'built-in', 'usb', 'default']) {
      expect(deviceIdForSelectValue(selectValueForDevice(id))).toBe(id);
    }
  });

  it('names the chosen device, falling back to the default when it has gone away', () => {
    expect(chosenDeviceLabel(microphones, 'usb')).toBe('Scarlett Solo USB');
    expect(chosenDeviceLabel(microphones, null)).toBe('System default');
    expect(chosenDeviceLabel(microphones, 'unplugged')).toBe('System default');
  });
});
