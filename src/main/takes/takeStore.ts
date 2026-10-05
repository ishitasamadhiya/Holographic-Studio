import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { planMix } from '@mixdown/mixPlan';
import { fail, ok, type Result } from '@shared/errors';
import {
  STEM_BYTES_PER_FRAME,
  type TakeInit,
  type TakeManifest,
  type TakeSummary,
} from '@shared/take';
import { writeFileAtomic } from '../util/atomicWrite';
import {
  BACKING_STEM_FILE,
  isTakeId,
  MANIFEST_FILE,
  videoExtensionForMimeType,
  videoFileName,
  VOCAL_STEM_FILE,
} from './takeFiles';
import { parseTakeInit, parseTakeManifest } from './takeManifest';
import { TakeRecording, type ByteSink } from './takeRecording';

/** Takes are temporary; anything this old was left behind by a crash or an abandoned session. */
export const STALE_TAKE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The UI counts the frames it sent and main counts the frames on disk. A difference of a
 * few blocks is repaired by trusting the smaller number; more than this means audio went
 * missing mid-take and the stems can no longer be trusted to line up.
 */
const MAX_FRAME_COUNT_MISMATCH_SEC = 1;

interface ActiveTake {
  dir: string;
  init: TakeInit;
  recording: TakeRecording;
  /** Set once the take has been finished successfully. */
  summary: TakeSummary | null;
}

/**
 * Temporary on-disk storage for recordings in progress: one folder per take under
 * `rootDir`, holding the two raw stems, the camera recording, and (once finished) the manifest.
 */
export class TakeStore {
  private readonly takes = new Map<string, ActiveTake>();

  constructor(private readonly rootDir: string) {}

  async begin(init: TakeInit): Promise<Result<{ takeId: string }>> {
    const parsed = parseTakeInit(init);
    if (!parsed) return fail('recording-failed', 'Invalid take description');

    const takeId = randomUUID();
    const dir = join(this.rootDir, takeId);
    const opened: ByteSink[] = [];
    try {
      await mkdir(dir, { recursive: true });
      const openSink = async (fileName: string): Promise<ByteSink> => {
        const handle = await open(join(dir, fileName), 'w');
        opened.push(handle);
        return handle;
      };
      const videoExtension = parsed.video ? videoExtensionForMimeType(parsed.video.mimeType) : null;
      const recording = new TakeRecording({
        vocal: await openSink(VOCAL_STEM_FILE),
        backing: await openSink(BACKING_STEM_FILE),
        video: videoExtension ? await openSink(videoFileName(videoExtension)) : null,
      });
      this.takes.set(takeId, { dir, init: parsed, recording, summary: null });
      return ok({ takeId });
    } catch (error) {
      await Promise.all(opened.map((sink) => sink.close().catch(() => undefined)));
      await rm(dir, { recursive: true, force: true });
      return fail('recording-failed', error);
    }
  }

  /** Queues one block of both stems. Chunks for unknown or finished takes are ignored. */
  appendAudio(takeId: string, vocal: Uint8Array, backing: Uint8Array): void {
    this.takes.get(takeId)?.recording.appendAudio(vocal, backing);
  }

  appendVideo(takeId: string, chunk: Uint8Array): void {
    this.takes.get(takeId)?.recording.appendVideo(chunk);
  }

  /** Records that part of the take was lost, so finish() fails instead of saving a gap. */
  markBroken(takeId: string, reason: string): void {
    this.takes.get(takeId)?.recording.fail(new Error(reason));
  }

  /**
   * Flushes the take to disk, checks it against the manifest and stores the manifest
   * (with the frame count that is really on disk). Calling it again returns the same summary.
   */
  async finish(takeId: string, manifest: TakeManifest): Promise<Result<TakeSummary>> {
    const take = this.takes.get(takeId);
    if (!take) return fail('recording-failed', 'Unknown take');
    if (take.summary) return ok(take.summary);

    const parsed = parseTakeManifest(manifest);
    if (!parsed) return fail('recording-failed', 'Invalid take manifest');
    if (parsed.mode !== take.init.mode || parsed.sampleRate !== take.init.sampleRate) {
      return fail('recording-failed', 'The manifest does not match how the take was started');
    }

    try {
      const sizes = await take.recording.close();
      const framesOnDisk = Math.floor(
        Math.min(sizes.vocalBytes, sizes.backingBytes) / STEM_BYTES_PER_FRAME,
      );
      if (framesOnDisk === 0) return fail('recording-failed', 'No audio was recorded');
      if (parsed.mode === 'video' && sizes.videoBytes === 0) {
        return fail('recording-failed', 'No video was recorded');
      }
      const mismatchFrames = Math.abs(parsed.audioFrames - framesOnDisk);
      if (mismatchFrames > MAX_FRAME_COUNT_MISMATCH_SEC * parsed.sampleRate) {
        return fail(
          'recording-failed',
          `The manifest reports ${parsed.audioFrames} audio frames but ${framesOnDisk} were stored`,
        );
      }

      const stored: TakeManifest = {
        ...parsed,
        audioFrames: Math.min(parsed.audioFrames, framesOnDisk),
      };
      await writeFileAtomic(join(take.dir, MANIFEST_FILE), JSON.stringify(stored, null, 2));

      const plan = planMix(stored);
      take.summary = {
        takeId,
        durationSec: plan.outputFrames / plan.sampleRate,
        audioBytes: sizes.vocalBytes + sizes.backingBytes,
        videoBytes: sizes.videoBytes,
      };
      return ok(take.summary);
    } catch (error) {
      return fail('recording-failed', error);
    }
  }

  /** Folder of a successfully finished take (what the exporter reads), otherwise null. */
  finishedTakeDir(takeId: string): string | null {
    const take = this.takes.get(takeId);
    return take?.summary ? take.dir : null;
  }

  /**
   * Takes that were begun but never successfully finished. Their files are still open, and
   * without a manifest they can never be exported.
   */
  unfinishedTakeIds(): string[] {
    return [...this.takes].filter(([, take]) => !take.summary).map(([takeId]) => takeId);
  }

  /** Deletes a take's files. Unknown ids and already-discarded takes are fine. */
  async discard(takeId: string): Promise<void> {
    if (!isTakeId(takeId)) return;
    const take = this.takes.get(takeId);
    this.takes.delete(takeId);
    await take?.recording.close().catch(() => undefined);
    await rm(join(this.rootDir, takeId), { recursive: true, force: true });
  }

  /**
   * Removes take folders nothing has touched for `maxAgeMs` (called once at startup).
   * Returns how many were removed.
   */
  async removeStaleTakes(maxAgeMs = STALE_TAKE_AGE_MS, now = Date.now()): Promise<number> {
    const entries = await readdir(this.rootDir, { withFileTypes: true }).catch(() => []);
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !isTakeId(entry.name) || this.takes.has(entry.name)) continue;
      const dir = join(this.rootDir, entry.name);
      const lastTouched = await newestModificationTime(dir);
      if (lastTouched !== null && now - lastTouched > maxAgeMs) {
        await rm(dir, { recursive: true, force: true });
        removed += 1;
      }
    }
    return removed;
  }
}

/** Latest mtime of a folder and the files directly inside it; null if it cannot be read. */
async function newestModificationTime(dir: string): Promise<number | null> {
  try {
    const names = await readdir(dir);
    const paths = [dir, ...names.map((name) => join(dir, name))];
    const times = await Promise.all(paths.map(async (path) => (await stat(path)).mtimeMs));
    return Math.max(...times);
  } catch {
    return null;
  }
}
