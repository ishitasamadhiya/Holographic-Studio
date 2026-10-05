// Settings edits take effect in the UI at once and are saved by the main process in the
// background. Saves never overlap, and edits made while one is under way travel together
// in the next, so dragging a slider does not queue up hundreds of file writes.
import { deepMerge } from '@renderer/state/staticStudio';
import type { DeepPartial, Settings } from '@shared/settings';
import { mergeSettings } from '@shared/settingsSchema';

export interface SettingsSyncOptions {
  /** HoloApi.settings.update */
  save: (patch: DeepPartial<Settings>) => Promise<Settings>;
  getSettings: () => Settings;
  /** Puts new settings in the store and applies their side effects. */
  applySettings: (next: Settings, previous: Settings) => void;
  onSaveFailed: (error: unknown) => void;
}

function sameSettings(a: Settings, b: Settings): boolean {
  // Both sides are plain JSON built field by field in the same order.
  return JSON.stringify(a) === JSON.stringify(b);
}

export class SettingsSync {
  private queued: DeepPartial<Settings> | null = null;
  private saving: Promise<void> | null = null;

  constructor(private readonly options: SettingsSyncOptions) {}

  /** Applies the patch now (validated and clamped exactly as main will) and saves it soon. */
  update(patch: DeepPartial<Settings>): void {
    const previous = this.options.getSettings();
    const next = mergeSettings(previous, patch);
    if (!sameSettings(previous, next)) this.options.applySettings(next, previous);

    this.queued = this.queued ? deepMerge(this.queued, patch) : patch;
    this.saving ??= this.saveQueued();
  }

  /** Resolves once every edit made so far has been answered by the main process. */
  async whenSaved(): Promise<void> {
    while (this.saving) await this.saving;
  }

  private async saveQueued(): Promise<void> {
    // Lets the edits of one burst (same tick) leave together.
    await Promise.resolve();
    while (this.queued) {
      const patch = this.queued;
      this.queued = null;
      try {
        const saved = await this.options.save(patch);
        // With newer edits still waiting, main's answer to those is the one to adopt.
        if (!this.queued) this.adopt(saved);
      } catch (error) {
        this.options.onSaveFailed(error);
      }
    }
    this.saving = null;
  }

  /** Main has the last word: whatever it stored is what the app shows and uses. */
  private adopt(saved: Settings): void {
    const current = this.options.getSettings();
    if (!sameSettings(current, saved)) this.options.applySettings(saved, current);
  }
}
