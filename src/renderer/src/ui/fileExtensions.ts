// File-name helpers for the FileDropZone. Extensions are compared without the dot and
// case-insensitively ("Song.MP3" matches "mp3").

/** "My Song.final.MP3" → "mp3". Returns "" when there is no extension. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  // A leading dot marks a hidden file (".gitignore"), not an extension.
  if (dot <= 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

export function isAcceptedFileName(fileName: string, extensions: readonly string[]): boolean {
  const extension = fileExtension(fileName);
  if (extension === '') return false;
  return extensions.some((accepted) => accepted.replace(/^\./, '').toLowerCase() === extension);
}

/** ["mp3", "wav", "m4a"] → "MP3, WAV or M4A". */
export function describeExtensions(extensions: readonly string[]): string {
  const names = extensions.map((extension) => extension.replace(/^\./, '').toUpperCase());
  const last = names[names.length - 1];
  if (last === undefined) return '';
  if (names.length === 1) return last;
  return `${names.slice(0, -1).join(', ')} or ${last}`;
}
