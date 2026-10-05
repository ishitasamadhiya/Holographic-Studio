import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, type DeepPartial, type Settings } from './settings';
import { mergeSettings, normalizeSettings, SETTINGS_RANGES } from './settingsSchema';

describe('normalizeSettings', () => {
  it.each([undefined, null, 42, 'settings', true, [], [1, 2, 3]])(
    'returns the defaults for unusable input %j',
    (raw) => {
      expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    },
  );

  it('returns a fresh object that shares nothing with the defaults', () => {
    const settings = normalizeSettings({});
    expect(settings).not.toBe(DEFAULT_SETTINGS);
    expect(settings.controls).not.toBe(DEFAULT_SETTINGS.controls);
    expect(settings.controls.autotune).not.toBe(DEFAULT_SETTINGS.controls.autotune);
    settings.controls.autotune.manual = 0.9;
    expect(DEFAULT_SETTINGS.controls.autotune.manual).toBe(0.5);
  });

  it('keeps every valid field of a complete settings object', () => {
    const custom: Settings = {
      version: SETTINGS_VERSION,
      onboardingComplete: true,
      mode: 'audio',
      devices: { microphoneId: 'mic-1', cameraId: 'cam-1', outputId: 'out-1' },
      video: { resolution: '720p' },
      audio: {
        monitoringEnabled: false,
        micGain: 1.5,
        monitorVolume: 0.25,
        backingVolume: 0.6,
        reverbEnabled: true,
      },
      controls: {
        handControlEnabled: false,
        autotune: { source: 'manual', manual: 0.1 },
        echo: { source: 'manual', manual: 0.2 },
        volume: { source: 'gesture', manual: 0.3 },
        extraGesturesEnabled: true,
      },
      recording: { countdownEnabled: false, countdownSec: 5 },
      calibration: { neutralHandScale: 0.21 },
      sync: { vocalOffsetMs: -12, videoOffsetMs: 40 },
      developer: { showLandmarks: true },
      lastSaveDir: '/Users/singer/Movies',
      lastSession: { backingPath: '/music/backing.mp3', referencePath: '/music/original.mp3' },
    };
    expect(normalizeSettings(custom)).toEqual(custom);
  });

  it('clamps numbers to their valid range', () => {
    const settings = normalizeSettings({
      audio: { micGain: 7, monitorVolume: -3, backingVolume: 1.01 },
      controls: { autotune: { manual: 2 }, echo: { manual: -1 } },
      recording: { countdownSec: 600 },
      sync: { vocalOffsetMs: -99999, videoOffsetMs: 99999 },
    });
    expect(settings.audio.micGain).toBe(SETTINGS_RANGES.micGain.max);
    expect(settings.audio.monitorVolume).toBe(0);
    expect(settings.audio.backingVolume).toBe(1);
    expect(settings.controls.autotune.manual).toBe(1);
    expect(settings.controls.echo.manual).toBe(0);
    expect(settings.recording.countdownSec).toBe(SETTINGS_RANGES.countdownSec.max);
    expect(settings.sync.vocalOffsetMs).toBe(SETTINGS_RANGES.syncOffsetMs.min);
    expect(settings.sync.videoOffsetMs).toBe(SETTINGS_RANGES.syncOffsetMs.max);
  });

  it('rejects wrong types field by field and keeps the valid neighbours', () => {
    const settings = normalizeSettings({
      onboardingComplete: 'yes',
      mode: 'hologram',
      devices: { microphoneId: 17, cameraId: 'cam-2', outputId: { id: 'x' } },
      video: { resolution: '4k' },
      audio: { monitoringEnabled: 0, micGain: '1.2', monitorVolume: 0.4, reverbEnabled: true },
      controls: {
        handControlEnabled: null,
        autotune: { source: 'telepathy', manual: 0.8 },
        echo: 'loud',
      },
      recording: { countdownEnabled: 'no', countdownSec: Number.NaN },
      calibration: { neutralHandScale: -1 },
      sync: { vocalOffsetMs: Number.POSITIVE_INFINITY, videoOffsetMs: 15 },
      developer: [],
      lastSaveDir: 12,
      lastSession: { backingPath: '/music/song.wav', referencePath: false },
    });

    expect(settings.onboardingComplete).toBe(false);
    expect(settings.mode).toBe('video');
    expect(settings.devices).toEqual({ microphoneId: null, cameraId: 'cam-2', outputId: null });
    expect(settings.video.resolution).toBe('1080p');
    expect(settings.audio).toEqual({
      monitoringEnabled: true,
      micGain: 1,
      monitorVolume: 0.4,
      backingVolume: 0.8,
      reverbEnabled: true,
    });
    expect(settings.controls.handControlEnabled).toBe(true);
    expect(settings.controls.autotune).toEqual({ source: 'gesture', manual: 0.8 });
    expect(settings.controls.echo).toEqual(DEFAULT_SETTINGS.controls.echo);
    expect(settings.recording).toEqual({ countdownEnabled: true, countdownSec: 3 });
    expect(settings.calibration.neutralHandScale).toBeNull();
    expect(settings.sync).toEqual({ vocalOffsetMs: 0, videoOffsetMs: 15 });
    expect(settings.developer.showLandmarks).toBe(false);
    expect(settings.lastSaveDir).toBeNull();
    expect(settings.lastSession).toEqual({ backingPath: '/music/song.wav', referencePath: null });
  });

  it('rounds the countdown to whole seconds', () => {
    expect(normalizeSettings({ recording: { countdownSec: 4.6 } }).recording.countdownSec).toBe(5);
  });

  it('treats empty and oversized strings as "nothing chosen"', () => {
    const settings = normalizeSettings({
      devices: { microphoneId: '', cameraId: 'x'.repeat(5000) },
      lastSaveDir: '',
    });
    expect(settings.devices.microphoneId).toBeNull();
    expect(settings.devices.cameraId).toBeNull();
    expect(settings.lastSaveDir).toBeNull();
  });

  it('drops unknown fields and survives prototype-pollution attempts', () => {
    const raw = JSON.parse(
      '{"mode":"audio","telemetry":true,"__proto__":{"polluted":true},"audio":{"micGain":0.5,"secret":1}}',
    ) as unknown;
    const settings = normalizeSettings(raw);
    expect(settings.mode).toBe('audio');
    expect(settings.audio.micGain).toBe(0.5);
    expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(Object.keys(settings.audio).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.audio).sort());
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([0, 99, 'two', null])(
    'keeps the recognised fields of a file written with version %j',
    (version) => {
      const settings = normalizeSettings({
        version,
        onboardingComplete: true,
        audio: { backingVolume: 0.3 },
        removedInALaterBuild: { anything: 1 },
      });
      expect(settings.version).toBe(SETTINGS_VERSION);
      expect(settings.onboardingComplete).toBe(true);
      expect(settings.audio.backingVolume).toBe(0.3);
      expect(settings.audio.micGain).toBe(DEFAULT_SETTINGS.audio.micGain);
    },
  );
});

describe('mergeSettings', () => {
  const base: Settings = normalizeSettings({
    onboardingComplete: true,
    mode: 'audio',
    devices: { microphoneId: 'mic-1' },
    audio: { micGain: 1.4 },
    controls: { echo: { source: 'manual', manual: 0.7 } },
    lastSaveDir: '/Users/singer/Movies',
  });

  it('changes only the fields named in the patch, at any depth', () => {
    const merged = mergeSettings(base, {
      audio: { backingVolume: 0.2 },
      controls: { echo: { manual: 0.1 } },
    });
    expect(merged.audio).toEqual({ ...base.audio, backingVolume: 0.2 });
    expect(merged.controls.echo).toEqual({ source: 'manual', manual: 0.1 });
    expect(merged.controls.autotune).toEqual(base.controls.autotune);
    expect(merged.mode).toBe('audio');
    expect(merged.lastSaveDir).toBe('/Users/singer/Movies');
  });

  it('does not mutate the base settings', () => {
    const snapshot = structuredClone(base);
    mergeSettings(base, { audio: { micGain: 0.1 }, devices: { microphoneId: null } });
    expect(base).toEqual(snapshot);
  });

  it('lets a patch clear nullable fields with null', () => {
    const merged = mergeSettings(base, { devices: { microphoneId: null }, lastSaveDir: null });
    expect(merged.devices.microphoneId).toBeNull();
    expect(merged.lastSaveDir).toBeNull();
  });

  it('keeps the current value when a patched value is invalid, instead of resetting it', () => {
    const invalidPatch = {
      mode: 'karaoke',
      audio: { micGain: 'loud' },
      controls: { echo: { source: 7 } },
    } as unknown as DeepPartial<Settings>;
    const merged = mergeSettings(base, invalidPatch);
    expect(merged.mode).toBe('audio');
    expect(merged.audio.micGain).toBe(1.4);
    expect(merged.controls.echo).toEqual({ source: 'manual', manual: 0.7 });
  });

  it('clamps patched numbers', () => {
    expect(mergeSettings(base, { audio: { micGain: 50 } }).audio.micGain).toBe(2);
  });

  it('treats an explicit undefined like a missing field', () => {
    const merged = mergeSettings(base, { mode: undefined, audio: { micGain: undefined } });
    expect(merged).toEqual(base);
  });
});
