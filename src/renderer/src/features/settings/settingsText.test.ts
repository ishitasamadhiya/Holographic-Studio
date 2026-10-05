import { describe, expect, it } from 'vitest';
import {
  buildDeviceOptions,
  describeMonitoringLatency,
  deviceIdToSelectValue,
  formatCountdownSeconds,
  formatGainPercent,
  formatOffsetMs,
  selectValueToDeviceId,
  SYSTEM_DEFAULT_VALUE,
} from './settingsText';

describe('device options', () => {
  it('always starts with the system default', () => {
    expect(buildDeviceOptions([], 'Microphone')).toEqual([
      { value: SYSTEM_DEFAULT_VALUE, label: 'System default' },
    ]);
  });

  it('lists devices by name and numbers the unnamed ones', () => {
    const options = buildDeviceOptions(
      [
        { id: 'a', label: 'Scarlett Solo USB' },
        { id: 'b', label: '  ' },
      ],
      'Microphone',
    );
    expect(options.slice(1)).toEqual([
      { value: 'a', label: 'Scarlett Solo USB' },
      { value: 'b', label: 'Microphone 2' },
    ]);
  });

  it('maps null to the system default and back', () => {
    expect(deviceIdToSelectValue(null)).toBe(SYSTEM_DEFAULT_VALUE);
    expect(deviceIdToSelectValue('a')).toBe('a');
    expect(selectValueToDeviceId(SYSTEM_DEFAULT_VALUE)).toBeNull();
    expect(selectValueToDeviceId('a')).toBe('a');
  });
});

describe('describeMonitoringLatency', () => {
  it('states the delay in whole milliseconds', () => {
    expect(describeMonitoringLatency(23.6)).toBe('You hear yourself about 24 ms after you sing.');
  });

  it('adds advice when the delay is long', () => {
    expect(describeMonitoringLatency(120)).toBe(
      'You hear yourself about 120 ms after you sing. Wired headphones usually make this shorter.',
    );
  });

  it('explains itself while the delay is unknown', () => {
    const unknown = describeMonitoringLatency(null);
    expect(unknown).toContain('once the microphone is on');
    expect(describeMonitoringLatency(Number.NaN)).toBe(unknown);
    expect(describeMonitoringLatency(-5)).toBe(unknown);
  });
});

describe('value formatting', () => {
  it('signs timing offsets', () => {
    expect(formatOffsetMs(15)).toBe('+15 ms');
    expect(formatOffsetMs(0)).toBe('0 ms');
    expect(formatOffsetMs(-20)).toBe('−20 ms');
    expect(formatOffsetMs(-0.2)).toBe('0 ms');
  });

  it('shows the microphone trim relative to unchanged', () => {
    expect(formatGainPercent(1)).toBe('100%');
    expect(formatGainPercent(0.85)).toBe('85%');
    expect(formatGainPercent(2)).toBe('200%');
  });

  it('pluralises countdown seconds', () => {
    expect(formatCountdownSeconds(1)).toBe('1 second');
    expect(formatCountdownSeconds(3)).toBe('3 seconds');
  });
});
