// Wording and value formatting for the settings sheet.
import type { DeviceOption } from '@renderer/state/studioTypes';

/** Select value standing for "no specific device" (Settings stores null for it). */
export const SYSTEM_DEFAULT_VALUE = '__system-default__';

export interface DeviceSelectOption {
  value: string;
  label: string;
}

/** "System default" followed by the devices; unnamed devices get a numbered name. */
export function buildDeviceOptions(
  devices: readonly DeviceOption[],
  unnamedLabel: string,
): DeviceSelectOption[] {
  return [
    { value: SYSTEM_DEFAULT_VALUE, label: 'System default' },
    ...devices.map((device, index) => ({
      value: device.id,
      label: device.label.trim() === '' ? `${unnamedLabel} ${index + 1}` : device.label,
    })),
  ];
}

export function deviceIdToSelectValue(deviceId: string | null): string {
  return deviceId ?? SYSTEM_DEFAULT_VALUE;
}

export function selectValueToDeviceId(value: string): string | null {
  return value === SYSTEM_DEFAULT_VALUE ? null : value;
}

/** Above this, the delay between singing and hearing yourself starts to get in the way. */
const COMFORTABLE_LATENCY_MS = 45;

/** The monitoring delay in plain words, e.g. "You hear yourself about 24 ms after you sing." */
export function describeMonitoringLatency(latencyMs: number | null): string {
  if (latencyMs === null || !Number.isFinite(latencyMs) || latencyMs < 0) {
    return 'The delay between singing and hearing yourself shows here once the microphone is on.';
  }
  const sentence = `You hear yourself about ${Math.round(latencyMs)} ms after you sing.`;
  return latencyMs > COMFORTABLE_LATENCY_MS
    ? `${sentence} Wired headphones usually make this shorter.`
    : sentence;
}

/** A timing offset with its sign: 15 → "+15 ms", 0 → "0 ms", -20 → "−20 ms". */
export function formatOffsetMs(offsetMs: number): string {
  const rounded = Math.round(offsetMs);
  if (rounded === 0) return '0 ms';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} ms`;
}

/** The microphone trim (linear, 1 = unchanged) as a percentage: 1 → "100%". */
export function formatGainPercent(gain: number): string {
  return `${Math.round(gain * 100)}%`;
}

export function formatCountdownSeconds(seconds: number): string {
  return seconds === 1 ? '1 second' : `${seconds} seconds`;
}
