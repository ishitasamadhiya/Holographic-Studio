import { stat } from 'node:fs/promises';

/** The first of the candidate paths that is an existing folder, or null if none is. */
export async function firstExistingDirectory(
  candidates: readonly (string | null | undefined)[],
): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const isDirectory = await stat(candidate).then(
      (stats) => stats.isDirectory(),
      () => false,
    );
    if (isDirectory) return candidate;
  }
  return null;
}
