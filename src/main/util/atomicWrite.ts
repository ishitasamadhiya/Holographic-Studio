import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Replaces `filePath` with `data` so that a reader (or a crash) only ever sees the old
 * complete file or the new complete file, never a half-written one: the data goes to a
 * temporary file in the same folder, is flushed to disk, and is then renamed into place.
 */
export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    const handle = await open(tempPath, 'w');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
