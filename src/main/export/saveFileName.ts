import { basename, extname } from 'node:path';

// Characters that cannot appear in file names on Windows or macOS, plus control characters.
const UNSAFE_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_FILE_NAME_LENGTH = 200;

/**
 * Turns the UI's suggested file name into a safe "<name>.mp4": no folders, no reserved
 * characters, always the right extension. Falls back to `fallbackName` when nothing is left.
 */
export function safeMp4FileName(suggested: unknown, fallbackName: string): string {
  const raw = typeof suggested === 'string' ? suggested : '';
  const lastSegment = raw.split(/[/\\]/).pop() ?? '';
  const withoutExtension = /\.mp4$/i.test(lastSegment) ? lastSegment.slice(0, -4) : lastSegment;
  const cleaned = withoutExtension
    .replace(UNSAFE_FILE_NAME_CHARACTERS, '')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, MAX_FILE_NAME_LENGTH);
  return cleaned.length > 0 ? `${cleaned}.mp4` : fallbackName;
}

/** Adds ".mp4" unless the path already ends with it (save dialogs do not always add it). */
export function withMp4Extension(path: string): string {
  return extname(basename(path)).toLowerCase() === '.mp4' ? path : `${path}.mp4`;
}
