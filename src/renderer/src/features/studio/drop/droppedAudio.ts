// Decides what to do with files dropped onto the studio window.
import { SUPPORTED_AUDIO_EXTENSIONS } from '@shared/ipc';
import { isAcceptedFileName } from '@renderer/ui/fileExtensions';

export type DroppedAudio =
  | { kind: 'none' }
  | { kind: 'accepted'; path: string; name: string }
  | { kind: 'rejected'; message: string };

/**
 * Picks the first audio file of a drop and resolves its path on disk.
 * @param pathFor window.holo.files.pathForDroppedFile in the app; "" means "not a file on disk".
 */
export function resolveDroppedAudio<DroppedFile extends { name: string }>(
  files: readonly DroppedFile[],
  pathFor: (file: DroppedFile) => string,
): DroppedAudio {
  const first = files[0];
  if (!first) return { kind: 'none' };

  const audio = files.find((file) => isAcceptedFileName(file.name, SUPPORTED_AUDIO_EXTENSIONS));
  if (!audio) {
    return {
      kind: 'rejected',
      message: `“${first.name}” is not an audio file. Try an MP3, WAV, or M4A file.`,
    };
  }

  let path = '';
  try {
    path = pathFor(audio);
  } catch {
    // Reported below like any other file that has no location on disk.
  }
  if (path === '') {
    return {
      kind: 'rejected',
      message: `“${audio.name}” could not be read. Use “Add backing track” instead.`,
    };
  }
  return { kind: 'accepted', path, name: audio.name };
}
