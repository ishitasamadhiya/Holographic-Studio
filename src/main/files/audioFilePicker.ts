import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron';
import {
  SUPPORTED_AUDIO_EXTENSIONS,
  type AudioFilePurpose,
  type PickedAudioFile,
} from '@shared/ipc';
import { describeAudioFile } from './audioFileReader';

const DIALOG_TEXT: Record<AudioFilePurpose, { title: string; message: string }> = {
  backing: {
    title: 'Choose a Backing Track',
    message: 'Choose the instrumental or karaoke track you want to sing over.',
  },
  reference: {
    title: 'Choose the Original Song',
    message: 'Choose the original song. It is only analyzed to guide the autotune, never played.',
  },
};

export function isAudioFilePurpose(value: unknown): value is AudioFilePurpose {
  return value === 'backing' || value === 'reference';
}

/** Shows the native open dialog. Resolves null when the user cancels. */
export async function pickAudioFile(
  purpose: AudioFilePurpose,
  parent: BrowserWindow | null,
): Promise<PickedAudioFile | null> {
  const options: OpenDialogOptions = {
    ...DIALOG_TEXT[purpose],
    buttonLabel: 'Choose',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: [...SUPPORTED_AUDIO_EXTENSIONS] }],
  };
  // Looked up on `dialog` at call time, so end-to-end tests can swap the dialog out.
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  const path = result.filePaths[0];
  if (result.canceled || !path) return null;
  return describeAudioFile(path);
}
