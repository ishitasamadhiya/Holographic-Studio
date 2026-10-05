import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isReferenceAnalysis,
  REFERENCE_ANALYSIS_SCHEMA_VERSION,
  type ReferenceAnalysis,
} from '@shared/music';
import { writeFileAtomic } from '../util/atomicWrite';

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Cache keys are sha256 digests. Checking that also guarantees a key cannot name a path. */
export function isAnalysisCacheKey(key: unknown): key is string {
  return typeof key === 'string' && SHA256_HEX.test(key);
}

/**
 * Reference-song analyses on disk, one JSON file per song, named after the song's content
 * hash and the analysis schema version (so a newer analyser never reads an older result).
 */
export class AnalysisCache {
  constructor(private readonly directory: string) {}

  /** Null on a miss. A damaged or outdated entry is deleted and also reported as a miss. */
  async get(key: string): Promise<ReferenceAnalysis | null> {
    if (!isAnalysisCacheKey(key)) return null;
    const filePath = this.pathFor(key);

    let text: string;
    try {
      text = await readFile(filePath, 'utf8');
    } catch {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (!isReferenceAnalysis(parsed)) {
      await rm(filePath, { force: true });
      return null;
    }
    return parsed;
  }

  async put(key: string, analysis: ReferenceAnalysis): Promise<void> {
    if (!isAnalysisCacheKey(key))
      throw new TypeError('Analysis cache keys must be sha256 hex digests');
    if (!isReferenceAnalysis(analysis)) throw new TypeError('Not a reference analysis');
    await writeFileAtomic(this.pathFor(key), JSON.stringify(analysis));
  }

  private pathFor(key: string): string {
    return join(this.directory, `${key}.v${REFERENCE_ANALYSIS_SCHEMA_VERSION}.json`);
  }
}
