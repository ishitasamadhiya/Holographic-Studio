import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REFERENCE_ANALYSIS_SCHEMA_VERSION, type ReferenceAnalysis } from '@shared/music';
import { AnalysisCache, isAnalysisCacheKey } from './analysisCache';

const keyOf = (text: string): string => createHash('sha256').update(text).digest('hex');
const KEY = keyOf('song one');

function sampleAnalysis(): ReferenceAnalysis {
  return {
    schemaVersion: REFERENCE_ANALYSIS_SCHEMA_VERSION,
    durationSec: 201.5,
    contour: { hopSec: 0.01, f0Hz: [0, 220, 221.5, 0], confidence: [0, 0.9, 0.8, 0] },
    notes: [{ startSec: 0.01, endSec: 0.03, midi: 57, confidence: 0.85 }],
    key: { tonic: 9, mode: 'minor', confidence: 0.7 },
    tuningCents: -4,
    quality: 'good',
    stats: { voicedRatio: 0.5, meanConfidence: 0.85, noteCount: 1 },
  };
}

let root: string;
let cacheDir: string;
let cache: AnalysisCache;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'holo-cache-'));
  cacheDir = join(root, 'analysis-cache');
  cache = new AnalysisCache(cacheDir);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('AnalysisCache', () => {
  it('misses when nothing was stored (even before the folder exists)', async () => {
    expect(await cache.get(KEY)).toBeNull();
  });

  it('returns exactly what was stored, also from a fresh instance', async () => {
    await cache.put(KEY, sampleAnalysis());
    expect(await cache.get(KEY)).toEqual(sampleAnalysis());
    expect(await new AnalysisCache(cacheDir).get(KEY)).toEqual(sampleAnalysis());
    expect(await cache.get(keyOf('another song'))).toBeNull();
  });

  it('names the file after the key and the schema version, and leaves no temp files', async () => {
    await cache.put(KEY, sampleAnalysis());
    expect(await readdir(cacheDir)).toEqual([`${KEY}.v${REFERENCE_ANALYSIS_SCHEMA_VERSION}.json`]);
  });

  it('overwrites an existing entry', async () => {
    await cache.put(KEY, sampleAnalysis());
    await cache.put(KEY, { ...sampleAnalysis(), tuningCents: 12 });
    expect((await cache.get(KEY))?.tuningCents).toBe(12);
  });

  it.each([
    ['unparseable JSON', '{"schemaVersion":1,"durationSec":'],
    [
      'a different schema version',
      JSON.stringify({ ...sampleAnalysis(), schemaVersion: REFERENCE_ANALYSIS_SCHEMA_VERSION + 1 }),
    ],
    ['the wrong shape', JSON.stringify({ schemaVersion: REFERENCE_ANALYSIS_SCHEMA_VERSION })],
  ])('treats an entry with %s as a miss and removes the file', async (_name, content) => {
    await cache.put(KEY, sampleAnalysis());
    const [fileName] = await readdir(cacheDir);
    await writeFile(join(cacheDir, fileName!), content);

    expect(await cache.get(KEY)).toBeNull();
    expect(await readdir(cacheDir)).toEqual([]);
  });

  it.each([
    '../../etc/passwd',
    '..',
    '',
    'abc',
    `${KEY}/../x`,
    `${KEY}.json`,
    KEY.toUpperCase(),
    `${KEY}0`,
  ])('refuses the key %j, so a key can never leave the cache folder', async (badKey) => {
    expect(isAnalysisCacheKey(badKey)).toBe(false);
    expect(await cache.get(badKey)).toBeNull();
    await expect(cache.put(badKey, sampleAnalysis())).rejects.toThrow(TypeError);
    await expect(readdir(cacheDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(root)).toEqual([]);
  });

  it('refuses to store something that is not an analysis', async () => {
    const notAnAnalysis = { schemaVersion: 1 } as unknown as ReferenceAnalysis;
    await expect(cache.put(KEY, notAnAnalysis)).rejects.toThrow(TypeError);
    expect(await cache.get(KEY)).toBeNull();
  });

  it('stores plain JSON that other tools can read', async () => {
    await cache.put(KEY, sampleAnalysis());
    const [fileName] = await readdir(cacheDir);
    expect(JSON.parse(await readFile(join(cacheDir, fileName!), 'utf8'))).toEqual(sampleAnalysis());
  });
});
