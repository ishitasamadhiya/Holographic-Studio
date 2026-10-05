// How the mix settings turn into gains. Pure, so the "headphones only" rules can be tested.
import { clamp01 } from '@shared/controls';
import { DEFAULT_SETTINGS } from '@shared/settings';
import type { MixSettings } from './engineTypes';

const MAX_MIC_GAIN = 2;

export const DEFAULT_MIX: Readonly<MixSettings> = { ...DEFAULT_SETTINGS.audio };

/**
 * Gain for a 0..1 volume slider. Squared, because loudness is not linear in gain: the
 * slider's lower half stays useful instead of everything happening in the top tenth.
 * 1 is unity, 0 is silence.
 */
export function volumeToGain(volume: number): number {
  const position = clamp01(volume);
  return position * position;
}

/** Level of the singer's own voice in the headphones. Never affects the recording. */
export function monitorGain(mix: MixSettings): number {
  return mix.monitoringEnabled ? volumeToGain(mix.monitorVolume) : 0;
}

/** Level of the backing track, both in the headphones and in the recorded backing stem. */
export function backingGain(mix: MixSettings): number {
  return volumeToGain(mix.backingVolume);
}

/** Overlays a partial update, clamping numbers into range and ignoring NaN and wrong types. */
export function mergeMix(current: MixSettings, patch: Partial<MixSettings>): MixSettings {
  const number = (value: unknown, fallback: number, max: number): number =>
    typeof value === 'number' && !Number.isNaN(value)
      ? Math.min(max, Math.max(0, value))
      : fallback;
  const flag = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;
  return {
    micGain: number(patch.micGain, current.micGain, MAX_MIC_GAIN),
    monitoringEnabled: flag(patch.monitoringEnabled, current.monitoringEnabled),
    monitorVolume: number(patch.monitorVolume, current.monitorVolume, 1),
    backingVolume: number(patch.backingVolume, current.backingVolume, 1),
    reverbEnabled: flag(patch.reverbEnabled, current.reverbEnabled),
  };
}
