import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { firstExistingDirectory } from './firstExistingDirectory';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'holo-dirs-'));
  await writeFile(join(dir, 'file.txt'), 'x');
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('firstExistingDirectory', () => {
  it('returns the first candidate that is a real folder, in order of preference', async () => {
    expect(await firstExistingDirectory([dir, tmpdir()])).toBe(dir);
    expect(await firstExistingDirectory([join(dir, 'unplugged'), dir])).toBe(dir);
  });

  it('skips missing folders, files, and empty candidates', async () => {
    expect(
      await firstExistingDirectory([
        null,
        undefined,
        '',
        join(dir, 'file.txt'),
        join(dir, 'gone'),
        dir,
      ]),
    ).toBe(dir);
  });

  it('returns null when nothing qualifies', async () => {
    expect(await firstExistingDirectory([])).toBeNull();
    expect(await firstExistingDirectory([null, join(dir, 'gone')])).toBeNull();
  });
});
