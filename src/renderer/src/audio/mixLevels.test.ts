import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings';
import type { MixSettings } from './engineTypes';
import { backingGain, DEFAULT_MIX, mergeMix, monitorGain, volumeToGain } from './mixLevels';

const mix: MixSettings = {
  micGain: 1,
  monitoringEnabled: true,
  monitorVolume: 1,
  backingVolume: 0.8,
  reverbEnabled: false,
};

describe('volumeToGain', () => {
  it('is silent at 0, unity at 1 and squared in between', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBe(0.25);
  });

  it('clamps out-of-range sliders', () => {
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(3)).toBe(1);
  });
});

describe('monitor and backing gain', () => {
  it('mutes the monitor when monitoring is off, whatever its volume', () => {
    expect(monitorGain(mix)).toBe(1);
    expect(monitorGain({ ...mix, monitorVolume: 0.5 })).toBe(0.25);
    expect(monitorGain({ ...mix, monitoringEnabled: false })).toBe(0);
  });

  it('does not let the monitoring switch touch the backing level', () => {
    expect(backingGain({ ...mix, monitoringEnabled: false })).toBe(backingGain(mix));
    expect(backingGain(mix)).toBeCloseTo(0.64, 12);
  });
});

describe('mergeMix', () => {
  it('starts from the same defaults as the settings file', () => {
    expect(DEFAULT_MIX).toEqual(DEFAULT_SETTINGS.audio);
  });

  it('changes only the given fields', () => {
    expect(mergeMix(mix, { backingVolume: 0.3 })).toEqual({ ...mix, backingVolume: 0.3 });
    expect(mergeMix(mix, {})).toEqual(mix);
  });

  it('clamps numbers into range', () => {
    const merged = mergeMix(mix, { micGain: 9, monitorVolume: -2, backingVolume: 1.5 });
    expect(merged).toEqual({ ...mix, micGain: 2, monitorVolume: 0, backingVolume: 1 });
  });

  it('ignores NaN and values of the wrong type', () => {
    const patch = { micGain: Number.NaN, monitoringEnabled: 'no', reverbEnabled: undefined };
    expect(mergeMix(mix, patch as unknown as Partial<MixSettings>)).toEqual(mix);
  });
});
