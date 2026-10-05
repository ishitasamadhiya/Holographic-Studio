import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findVideoFile, isTakeId, videoExtensionForMimeType } from './takeFiles';

describe('videoExtensionForMimeType', () => {
  it.each([
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=h264', 'webm'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm; codecs="vp8"', 'webm'],
    ['VIDEO/WEBM;codecs=vp9', 'webm'],
    ['video/x-matroska;codecs=avc1', 'mkv'],
  ])('%s -> %s', (mimeType, extension) => {
    expect(videoExtensionForMimeType(mimeType)).toBe(extension);
  });

  it.each(['video/quicktime', 'audio/webm', '', 'webm', 'video/webm/../../x'])(
    'does not know %j',
    (mimeType) => {
      expect(videoExtensionForMimeType(mimeType)).toBeNull();
    },
  );
});

describe('findVideoFile', () => {
  it('finds the recording whatever its container, and reports null when there is none', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'holo-takefiles-'));
    try {
      expect(await findVideoFile(dir)).toBeNull();
      await mkdir(join(dir, 'video.mp4'));
      expect(await findVideoFile(dir)).toBeNull();
      await writeFile(join(dir, 'video.mkv'), 'x');
      expect(await findVideoFile(dir)).toBe(join(dir, 'video.mkv'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('isTakeId', () => {
  it('accepts random UUIDs', () => {
    expect(isTakeId(randomUUID())).toBe(true);
  });

  it.each([
    '',
    '..',
    '../other-take',
    'take-1',
    `${randomUUID()}/..`,
    randomUUID().toUpperCase(),
    42,
    null,
    undefined,
  ])('rejects %j', (value) => {
    expect(isTakeId(value)).toBe(false);
  });
});
