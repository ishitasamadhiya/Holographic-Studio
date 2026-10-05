import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeepPartial, Settings } from '@shared/settings';
import { mergeSettings, normalizeSettings } from '@shared/settingsSchema';
import { writeFileAtomic } from '../util/atomicWrite';
import { SerialQueue } from '../util/serialQueue';

export const SETTINGS_FILE_NAME = 'settings.json';
export const CORRUPT_SETTINGS_SUFFIX = '.corrupt';

/**
 * The app's settings, kept in memory and mirrored to <directory>/settings.json.
 * All operations run one at a time, so overlapping updates can neither lose each other's
 * changes nor leave the file older than the settings in memory.
 */
export class SettingsStore {
  readonly filePath: string;
  private current: Settings | null = null;
  private readonly queue = new SerialQueue();

  constructor(directory: string) {
    this.filePath = join(directory, SETTINGS_FILE_NAME);
  }

  /** Missing file: the defaults. Unreadable content: the defaults, and the file is set aside. */
  load(): Promise<Settings> {
    return this.queue.run(() => this.ensureLoaded());
  }

  /**
   * Applies a partial change and persists it. If the file cannot be written the promise
   * rejects and the settings stay exactly as they were.
   */
  update(patch: DeepPartial<Settings>): Promise<Settings> {
    return this.queue.run(async () =>
      this.persist(mergeSettings(await this.ensureLoaded(), patch)),
    );
  }

  reset(): Promise<Settings> {
    return this.queue.run(() => this.persist(normalizeSettings(undefined)));
  }

  private async ensureLoaded(): Promise<Settings> {
    this.current ??= await this.readFromDisk();
    return this.current;
  }

  private async persist(settings: Settings): Promise<Settings> {
    await writeFileAtomic(this.filePath, `${JSON.stringify(settings, null, 2)}\n`);
    this.current = settings;
    return settings;
  }

  private async readFromDisk(): Promise<Settings> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch {
      return normalizeSettings(undefined);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      await this.setCorruptFileAside();
      return normalizeSettings(undefined);
    }
    return normalizeSettings(parsed);
  }

  /** Keeps the damaged file for diagnosis instead of silently overwriting it. */
  private async setCorruptFileAside(): Promise<void> {
    await rename(this.filePath, this.filePath + CORRUPT_SETTINGS_SUFFIX).catch(() => undefined);
  }
}
