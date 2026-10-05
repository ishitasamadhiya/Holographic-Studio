import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SUPPORTED_AUDIO_EXTENSIONS } from '@shared/ipc';
import { describeAudioFile, hasSupportedAudioExtension, readAudioFile } from './audioFileReader';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'holo-files-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('hasSupportedAudioExtension', () => {
  it.each(SUPPORTED_AUDIO_EXTENSIONS)('accepts .%s in any letter case', (extension) => {
    expect(hasSupportedAudioExtension(`/music/song.${extension}`)).toBe(true);
    expect(hasSupportedAudioExtension(`/music/SONG.${extension.toUpperCase()}`)).toBe(true);
  });

  it.each(['/music/song.txt', '/music/song', '/music/song.mp3.exe', '/music/.mp3', '/music/mp3'])(
    'rejects %s',
    (path) => {
      expect(hasSupportedAudioExtension(path)).toBe(false);
    },
  );
});

describe('readAudioFile', () => {
  it('returns the exact bytes, their sha256, and the file details', async () => {
    // Larger than one stream chunk (64 KiB) so the streaming path is exercised.
    const content = randomBytes(300_000);
    const path = join(dir, 'My Song.MP3');
    await writeFile(path, content);

    const result = await readAudioFile(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.path).toBe(path);
    expect(result.value.name).toBe('My Song.MP3');
    expect(result.value.sizeBytes).toBe(300_000);
    expect(result.value.sha256).toBe(createHash('sha256').update(content).digest('hex'));
    expect(result.value.bytes).toBeInstanceOf(ArrayBuffer);
    expect(result.value.bytes.byteLength).toBe(300_000);
    expect(Buffer.from(result.value.bytes).equals(content)).toBe(true);
  });

  it('reports a wrong extension as an unsupported file without touching it', async () => {
    const path = join(dir, 'notes.txt');
    await writeFile(path, 'hello');
    const result = await readAudioFile(path);
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported-audio-file' } });
  });

  it('reports a missing file as a read failure with a friendly message', async () => {
    const result = await readAudioFile(join(dir, 'gone.wav'));
    expect(result).toMatchObject({ ok: false, error: { code: 'file-read-failed' } });
    if (result.ok) return;
    expect(result.error.message).toMatch(/could not be read/);
    expect(result.error.detail).toMatch(/ENOENT/);
  });

  it('reports a folder with an audio-looking name as a read failure', async () => {
    const path = join(dir, 'album.wav');
    await mkdir(path);
    expect(await readAudioFile(path)).toMatchObject({
      ok: false,
      error: { code: 'file-read-failed' },
    });
  });

  it('refuses relative paths', async () => {
    expect(await readAudioFile('song.wav')).toMatchObject({
      ok: false,
      error: { code: 'file-read-failed' },
    });
  });

  it('refuses empty files and files over the size limit', async () => {
    const empty = join(dir, 'empty.wav');
    await writeFile(empty, '');
    expect(await readAudioFile(empty)).toMatchObject({
      ok: false,
      error: { code: 'unsupported-audio-file' },
    });

    const big = join(dir, 'big.wav');
    await writeFile(big, randomBytes(2000));
    expect(await readAudioFile(big, 1999)).toMatchObject({
      ok: false,
      error: { code: 'unsupported-audio-file' },
    });
    expect((await readAudioFile(big, 2000)).ok).toBe(true);
  });
});

describe('describeAudioFile', () => {
  it('reports name and size', async () => {
    const path = join(dir, 'backing.m4a');
    await writeFile(path, randomBytes(1234));
    expect(await describeAudioFile(path)).toEqual({ path, name: 'backing.m4a', sizeBytes: 1234 });
  });

  it('still describes a file that cannot be inspected, so reading it can explain why', async () => {
    const path = join(dir, 'vanished.wav');
    expect(await describeAudioFile(path)).toEqual({ path, name: 'vanished.wav', sizeBytes: 0 });
  });
});
