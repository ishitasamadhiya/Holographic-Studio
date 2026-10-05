import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from './atomicWrite';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'holo-atomic-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('creates the file (and missing parent folders) with the given content', async () => {
    const path = join(dir, 'nested', 'deeper', 'file.json');
    await writeFileAtomic(path, '{"a":1}');
    expect(await readFile(path, 'utf8')).toBe('{"a":1}');
  });

  it('replaces an existing file and leaves no temporary files behind', async () => {
    const path = join(dir, 'file.bin');
    await writeFile(path, 'old content that is longer');
    await writeFileAtomic(path, new Uint8Array([1, 2, 3]));
    expect([...(await readFile(path))]).toEqual([1, 2, 3]);
    expect(await readdir(dir)).toEqual(['file.bin']);
  });

  it('keeps the previous file intact and cleans up when the write cannot complete', async () => {
    // A folder sitting at the destination makes the final rename fail.
    const path = join(dir, 'target');
    await mkdir(path);
    await writeFile(join(path, 'keep.txt'), 'precious');
    await expect(writeFileAtomic(path, 'new')).rejects.toThrow();
    expect(await readFile(join(path, 'keep.txt'), 'utf8')).toBe('precious');
    expect(await readdir(dir)).toEqual(['target']);
  });
});
