import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { mixTake } from '@mixdown/mixTake';
import { planMix } from '@mixdown/mixPlan';
import { fail, ok, type Result } from '@shared/errors';
import type { ExportResult, TakeManifest } from '@shared/take';
import {
  BACKING_STEM_FILE,
  findVideoFile,
  MANIFEST_FILE,
  VOCAL_STEM_FILE,
} from '../takes/takeFiles';
import { parseTakeManifest } from '../takes/takeManifest';
import { buildStillExportArgs, buildVideoExportArgs } from './encodeArgs';
import { createExportProgress, type ExportStageProgress } from './exportProgress';
import { runFfmpeg, type FfmpegOutcome } from './ffmpegProcess';
import { preferredVideoEncoders, videoBitrateKbps, type VideoEncoder } from './videoEncoders';

export interface ExportTakeOptions {
  /** Folder of a finished take (stems, manifest.json and, in video mode, the recording). */
  takeDir: string;
  /** Where the finished .mp4 goes. An existing file is replaced. */
  outputPath: string;
  ffmpegPath: string;
  /** Audio-only takes: PNG shown for the whole video. Omitted: a plain dark frame. */
  artworkPng?: Uint8Array;
  onProgress?: (progress: ExportStageProgress) => void;
  /** Aborting stops the export and removes everything it wrote. */
  signal?: AbortSignal;
  /**
   * Video encoders to try in order; the next one is used when one fails.
   * Default: the hardware encoder when this machine has a working one, then libx264.
   */
  videoEncoders?: readonly VideoEncoder[];
}

/** Temporary files the export creates inside the take folder. */
const MIX_FILE = 'mix.wav';
const ARTWORK_FILE = 'artwork.png';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** "<folder>/My Take.mp4" is written as "<folder>/My Take.<token>.partial.mp4" until it is complete. */
export function partialOutputPath(outputPath: string, token: string): string {
  const name = basename(outputPath, extname(outputPath));
  return join(dirname(outputPath), `${name}.${token}.partial.mp4`);
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/**
 * A temporary path in the destination folder that no existing file has. The export
 * overwrites this path and deletes it afterwards, so it must never be a file the user
 * already keeps there; a fresh random token (and a check, for good measure) guarantees that.
 */
async function unusedPartialOutputPath(outputPath: string): Promise<string> {
  for (;;) {
    const candidate = partialOutputPath(outputPath, randomBytes(4).toString('hex'));
    if (!(await pathExists(candidate))) return candidate;
  }
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

async function readManifest(takeDir: string): Promise<TakeManifest | null> {
  try {
    const text = await readFile(join(takeDir, MANIFEST_FILE), 'utf8');
    return parseTakeManifest(JSON.parse(text));
  } catch {
    return null;
  }
}

async function isWritableFolder(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isDirectory()) return false;
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Runs the encode with each encoder in turn until one does not fail. */
async function encodeWithFallback(
  encoders: readonly VideoEncoder[],
  encode: (encoder: VideoEncoder) => Promise<FfmpegOutcome>,
): Promise<FfmpegOutcome> {
  let outcome: FfmpegOutcome = {
    status: 'failed',
    exitCode: null,
    stderrTail: 'No video encoder is available',
  };
  for (const encoder of encoders) {
    outcome = await encode(encoder);
    if (outcome.status !== 'failed') break;
  }
  return outcome;
}

/**
 * Turns a finished take into one MP4 (H.264 + AAC): mixes the stems down to a temporary WAV,
 * then has FFmpeg encode it together with the camera recording — or, for an audio-only take,
 * with a still picture. The file appears under its final name only once it is complete.
 * The take folder itself is left untouched, so a failed export can simply be tried again.
 */
export async function exportTake(options: ExportTakeOptions): Promise<Result<ExportResult>> {
  const { takeDir, outputPath, ffmpegPath, artworkPng, signal } = options;
  const report = createExportProgress(options.onProgress);

  const manifest = await readManifest(takeDir);
  if (!manifest) return fail('export-failed', 'The take has no valid manifest');
  const plan = planMix(manifest);
  if (plan.outputFrames === 0) return fail('export-failed', 'The take is empty');
  const durationSec = plan.outputFrames / plan.sampleRate;

  const videoPath = manifest.mode === 'video' ? await findVideoFile(takeDir) : null;
  if (manifest.mode === 'video' && !videoPath) {
    return fail('export-failed', 'The take has no video recording');
  }
  if (artworkPng && !isPng(artworkPng)) return fail('export-failed', 'The artwork is not a PNG');
  if (!(await isWritableFolder(dirname(outputPath)))) {
    return fail('output-folder-unavailable', `Cannot write to ${dirname(outputPath)}`);
  }

  const mixPath = join(takeDir, MIX_FILE);
  const artworkPath = join(takeDir, ARTWORK_FILE);
  const partialPath = await unusedPartialOutputPath(outputPath);
  const onEncodedSeconds = (seconds: number): void => report('encoding', seconds / durationSec);

  const encodeVideoTake = async (
    recordingPath: string,
    video: NonNullable<TakeManifest['video']>,
  ): Promise<FfmpegOutcome> => {
    const bitrateKbps = videoBitrateKbps(video.width, video.height);
    const encoders = options.videoEncoders ?? (await preferredVideoEncoders(ffmpegPath));
    return encodeWithFallback(encoders, (encoder) =>
      runFfmpeg({
        ffmpegPath,
        args: buildVideoExportArgs({
          videoPath: recordingPath,
          audioPath: mixPath,
          outputPath: partialPath,
          durationSec,
          encoder,
          bitrateKbps,
        }),
        signal,
        onOutputSeconds: onEncodedSeconds,
      }),
    );
  };

  const encodeAudioOnlyTake = async (): Promise<FfmpegOutcome> => {
    if (artworkPng) await writeFile(artworkPath, artworkPng);
    return runFfmpeg({
      ffmpegPath,
      args: buildStillExportArgs({
        artworkPath: artworkPng ? artworkPath : null,
        audioPath: mixPath,
        outputPath: partialPath,
        durationSec,
      }),
      signal,
      onOutputSeconds: onEncodedSeconds,
    });
  };

  try {
    signal?.throwIfAborted();
    report('mixing', 0);
    await mixTake({
      vocalPath: join(takeDir, VOCAL_STEM_FILE),
      backingPath: join(takeDir, BACKING_STEM_FILE),
      manifest,
      outputWavPath: mixPath,
      onProgress: (fraction) => report('mixing', fraction),
      signal,
    });

    report('encoding', 0);
    const outcome =
      videoPath && manifest.video
        ? await encodeVideoTake(videoPath, manifest.video)
        : await encodeAudioOnlyTake();
    if (outcome.status === 'cancelled') return fail('export-cancelled');
    if (outcome.status === 'failed') {
      return fail(
        'export-failed',
        `FFmpeg exited with code ${outcome.exitCode}: ${outcome.stderrTail}`,
      );
    }

    report('finishing', 0);
    try {
      await rename(partialPath, outputPath);
    } catch (error) {
      return fail('output-folder-unavailable', error);
    }
    const { size } = await stat(outputPath);
    report('finishing', 1);
    return ok({ outputPath, durationSec, sizeBytes: size });
  } catch (error) {
    return signal?.aborted ? fail('export-cancelled') : fail('export-failed', error);
  } finally {
    await Promise.all([mixPath, artworkPath, partialPath].map((path) => rm(path, { force: true })));
  }
}
