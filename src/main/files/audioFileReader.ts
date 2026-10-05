import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import { fail, ok, type Result } from '@shared/errors';
import {
  SUPPORTED_AUDIO_EXTENSIONS,
  type LoadedAudioFile,
  type PickedAudioFile,
} from '@shared/ipc';

/**
 * Songs are handed to the UI in one piece, so there has to be a limit. 512 MiB is far beyond
 * any real song (an hour of CD-quality WAV is about 635 MB; ten minutes at 96 kHz / 24 bit
 * is 345 MB) while keeping a mistaken pick of a huge file from exhausting memory.
 */
export const MAX_AUDIO_FILE_BYTES = 512 * 1024 * 1024;

export function hasSupportedAudioExtension(path: string): boolean {
  return SUPPORTED_AUDIO_EXTENSIONS.includes(extname(path).slice(1).toLowerCase());
}

/**
 * Name and size of a file the user just picked. If the file cannot be inspected the size is
 * reported as 0 and reading it afterwards produces the proper, friendly error.
 */
export async function describeAudioFile(path: string): Promise<PickedAudioFile> {
  const sizeBytes = await stat(path).then(
    (stats) => stats.size,
    () => 0,
  );
  return { path, name: basename(path), sizeBytes };
}

/** Reads a whole audio file and hashes it on the way through. */
export async function readAudioFile(
  path: string,
  maxBytes: number = MAX_AUDIO_FILE_BYTES,
): Promise<Result<LoadedAudioFile>> {
  if (!isAbsolute(path)) return fail('file-read-failed', 'The path is not absolute');
  if (!hasSupportedAudioExtension(path)) {
    return fail('unsupported-audio-file', `Unsupported extension "${extname(path)}"`);
  }

  let sizeBytes: number;
  try {
    const stats = await stat(path);
    if (!stats.isFile()) return fail('file-read-failed', 'Not a regular file');
    sizeBytes = stats.size;
  } catch (error) {
    return fail('file-read-failed', error);
  }
  if (sizeBytes === 0) return fail('unsupported-audio-file', 'The file is empty');
  if (sizeBytes > maxBytes) {
    return fail('unsupported-audio-file', `The file is too large (${sizeBytes} bytes)`);
  }

  try {
    const { bytes, sha256 } = await readAndHash(path, sizeBytes);
    return ok({ path, name: basename(path), sizeBytes: bytes.byteLength, sha256, bytes });
  } catch (error) {
    return fail('file-read-failed', error);
  }
}

async function readAndHash(
  path: string,
  expectedBytes: number,
): Promise<{ bytes: ArrayBuffer; sha256: string }> {
  const hash = createHash('sha256');
  // A standalone ArrayBuffer (not a pooled Node Buffer) so it crosses IPC as-is.
  const contents = new Uint8Array(expectedBytes);
  let filled = 0;

  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    if (filled + chunk.length > expectedBytes) {
      throw new Error('The file changed while it was being read');
    }
    hash.update(chunk);
    contents.set(chunk, filled);
    filled += chunk.length;
  }

  const bytes = filled === expectedBytes ? contents.buffer : contents.buffer.slice(0, filled);
  return { bytes, sha256: hash.digest('hex') };
}
