import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type DeepPartial, type Settings } from '@shared/settings';
import { CORRUPT_SETTINGS_SUFFIX, SETTINGS_FILE_NAME, SettingsStore } from './settingsStore';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'holo-settings-'));
  filePath = join(dir, SETTINGS_FILE_NAME);
});
afterEach(async () => {
  await chmod(dir, 0o700).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

async function readStoredSettings(): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

describe('SettingsStore', () => {
  it('returns the defaults when there is no settings file, without creating one', async () => {
    const store = new SettingsStore(dir);
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    expect(await readdir(dir)).toEqual([]);
  });

  it('creates the data folder on first write', async () => {
    const store = new SettingsStore(join(dir, 'not', 'yet', 'there'));
    await store.update({ mode: 'audio' });
    expect((await new SettingsStore(join(dir, 'not', 'yet', 'there')).load()).mode).toBe('audio');
  });

  it('persists updates so a new store (the next app launch) sees them', async () => {
    const store = new SettingsStore(dir);
    const updated = await store.update({
      onboardingComplete: true,
      audio: { micGain: 1.25 },
      controls: { echo: { source: 'manual', manual: 0.4 } },
    });
    expect(updated.audio.micGain).toBe(1.25);
    expect(updated.audio.backingVolume).toBe(DEFAULT_SETTINGS.audio.backingVolume);

    const reloaded = await new SettingsStore(dir).load();
    expect(reloaded).toEqual(updated);
    expect(await readStoredSettings()).toEqual(updated);
  });

  it('normalises what it writes: invalid values never reach the file', async () => {
    const store = new SettingsStore(dir);
    const hostilePatch = {
      audio: { micGain: 99, monitorVolume: 'max' },
      injected: 'field',
    } as unknown as DeepPartial<Settings>;
    const updated = await store.update(hostilePatch);
    expect(updated.audio.micGain).toBe(2);
    expect(updated.audio.monitorVolume).toBe(DEFAULT_SETTINGS.audio.monitorVolume);
    expect(await readStoredSettings()).toEqual(updated);
    expect(await readStoredSettings()).not.toHaveProperty('injected');
  });

  it('repairs a file with damaged fields on load and keeps the good ones', async () => {
    await writeFile(
      filePath,
      JSON.stringify({ version: 0, mode: 'audio', audio: { micGain: 'x', backingVolume: 0.3 } }),
    );
    const settings = await new SettingsStore(dir).load();
    expect(settings.mode).toBe('audio');
    expect(settings.audio.micGain).toBe(1);
    expect(settings.audio.backingVolume).toBe(0.3);
  });

  it.each([
    ['truncated JSON', '{"mode":"audio","audio":{"micG'],
    ['an empty file', ''],
    ['JSON that is not an object', '[1,2,3]'],
  ])('falls back to the defaults for %s and keeps a .corrupt backup', async (_name, content) => {
    await writeFile(filePath, content);
    const store = new SettingsStore(dir);

    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    expect(await readFile(filePath + CORRUPT_SETTINGS_SUFFIX, 'utf8')).toBe(content);
    expect((await readdir(dir)).sort()).toEqual([SETTINGS_FILE_NAME + CORRUPT_SETTINGS_SUFFIX]);

    // The store keeps working, and the backup survives the next write.
    await store.update({ mode: 'audio' });
    expect((await new SettingsStore(dir).load()).mode).toBe('audio');
    expect(await readFile(filePath + CORRUPT_SETTINGS_SUFFIX, 'utf8')).toBe(content);
  });

  it('reset() restores and persists the defaults', async () => {
    const store = new SettingsStore(dir);
    await store.update({ mode: 'audio', audio: { micGain: 0.5 } });
    expect(await store.reset()).toEqual(DEFAULT_SETTINGS);
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    expect(await new SettingsStore(dir).load()).toEqual(DEFAULT_SETTINGS);
  });

  it('applies overlapping updates in order without losing any of them', async () => {
    const store = new SettingsStore(dir);
    const updates: Promise<Settings>[] = [];
    for (let step = 1; step <= 40; step++) {
      updates.push(store.update({ sync: { vocalOffsetMs: step } }));
      updates.push(store.update({ audio: { backingVolume: step / 40 } }));
      updates.push(store.update({ recording: { countdownSec: (step % 10) + 1 } }));
    }
    const results = await Promise.all(updates);

    // Every result reflects exactly the updates queued before it.
    expect(results[0]!.sync.vocalOffsetMs).toBe(1);
    expect(results[0]!.audio.backingVolume).toBe(DEFAULT_SETTINGS.audio.backingVolume);
    expect(results[4]!.sync.vocalOffsetMs).toBe(2);
    expect(results[4]!.audio.backingVolume).toBe(2 / 40);
    expect(results[4]!.recording.countdownSec).toBe(2);

    const last = results.at(-1)!;
    expect(last.sync.vocalOffsetMs).toBe(40);
    expect(last.audio.backingVolume).toBe(1);
    expect(last.recording.countdownSec).toBe(1);
    // The file ends up holding the last state, not an earlier write that finished late.
    expect(await readStoredSettings()).toEqual(last);
    expect(await readdir(dir)).toEqual([SETTINGS_FILE_NAME]);
  });

  it('rejects an update that cannot be saved and keeps the previous settings', async () => {
    const store = new SettingsStore(dir);
    await store.update({ mode: 'audio' });

    await chmod(dir, 0o500);
    await expect(store.update({ mode: 'video' })).rejects.toThrow();
    await chmod(dir, 0o700);

    expect((await store.load()).mode).toBe('audio');
    expect((await new SettingsStore(dir).load()).mode).toBe('audio');
    // The store is not stuck: the next update works.
    expect((await store.update({ mode: 'video' })).mode).toBe('video');
  });
});
