import { dirname, join } from 'node:path';
import { app, dialog, type BrowserWindow, type SaveDialogOptions } from 'electron';
import { defaultTakeFileName } from '@shared/take';
import type { SettingsStore } from '../settings/settingsStore';
import { firstExistingDirectory } from '../util/firstExistingDirectory';
import { safeMp4FileName, withMp4Extension } from './saveFileName';

type StandardFolder = 'videos' | 'desktop' | 'home';

/** app.getPath throws when the operating system has no such folder. */
function standardFolder(name: StandardFolder): string | null {
  try {
    return app.getPath(name);
  } catch {
    return null;
  }
}

/**
 * Shows the native save dialog for an exported take. It opens in the folder used last time
 * (if that still exists), otherwise in Movies, Desktop or the home folder; the folder the
 * user picks is remembered. Resolves null when the user cancels.
 */
export async function chooseSavePath(
  suggestedFileName: unknown,
  settings: SettingsStore,
  parent: BrowserWindow | null,
): Promise<string | null> {
  const { lastSaveDir } = await settings.load();
  const folder = await firstExistingDirectory([
    lastSaveDir,
    standardFolder('videos'),
    standardFolder('desktop'),
    standardFolder('home'),
  ]);
  const fileName = safeMp4FileName(suggestedFileName, defaultTakeFileName(new Date()));

  const options: SaveDialogOptions = {
    title: 'Save Your Take',
    buttonLabel: 'Save',
    defaultPath: folder ? join(folder, fileName) : fileName,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  };
  // Looked up on `dialog` at call time, so end-to-end tests can swap the dialog out.
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;

  const savePath = withMp4Extension(result.filePath);
  // Remembering the folder is a convenience; failing to store it must not block the save.
  await settings.update({ lastSaveDir: dirname(savePath) }).catch(() => undefined);
  return savePath;
}
