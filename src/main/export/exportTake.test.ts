// End-to-end tests of the exporter against the real bundled FFmpeg: synthetic takes go in,
// the resulting MP4 files are inspected with ffprobe and by decoding them again.
import { readdirSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Result } from '@shared/errors';
import type { ExportResult, ExportStage, TakeManifest } from '@shared/take';
import {
  decodeAudio,
  ffmpegPath,
  findClickTimes,
  frameBrightness,
  makePng,
  probeMedia,
  topLevelMp4Boxes,
  videoStartIgnoringEditList,
  writeSyntheticTake,
  type SyntheticTakeOptions,
  type VideoFlavour,
} from '../../../tests/e2e/helpers/takeFixtures';
import { MANIFEST_FILE } from '../takes/takeFiles';
import { exportTake, partialOutputPath } from './exportTake';
import type { ExportStageProgress } from './exportProgress';
import {
  HARDWARE_H264,
  isHardwareEncoderUsable,
  SOFTWARE_H264,
  videoBitrateKbps,
  type VideoEncoder,
} from './videoEncoders';

const CLICK_TOLERANCE_SEC = 0.002;
const DURATION_TOLERANCE_SEC = 0.05;
const FRAME_SEC = 1 / 30;

let root: string;
let takeCounter = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'holo-export-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeTake(
  options: SyntheticTakeOptions,
): Promise<{ takeDir: string; manifest: TakeManifest }> {
  const takeDir = join(root, `take-${++takeCounter}`);
  await mkdir(takeDir);
  return { takeDir, manifest: await writeSyntheticTake(takeDir, options) };
}

async function makeOutputDir(): Promise<string> {
  const dir = join(root, `out-${++takeCounter}`);
  await mkdir(dir);
  return dir;
}

function expectOk(result: Result<ExportResult>): ExportResult {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`);
  return result.value;
}

function expectClose(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
): void {
  expect(actual.length, `found ${JSON.stringify(actual)}`).toBe(expected.length);
  expected.forEach((time, index) => {
    expect(
      Math.abs(actual[index]! - time),
      `click ${index}: ${actual[index]} vs ${time}`,
    ).toBeLessThan(tolerance);
  });
}

/** A 3-second, 320x240 video take whose video started 0.4 s after the audio. */
function smallVideoTake(flavour: VideoFlavour, extra: Partial<SyntheticTakeOptions['video']> = {}) {
  const startOffsetSec = 0.4;
  return {
    stemSec: 4.5,
    vocalLatencySec: 0.03,
    // Heard 0.5, 1.0 and 2.0 seconds after the first video frame.
    clickTimesSec: [startOffsetSec + 0.5, startOffsetSec + 1.0, startOffsetSec + 2.0],
    video: {
      flavour,
      width: 320,
      height: 240,
      durationSec: 3,
      startOffsetSec,
      flashAtSec: 1.0,
      ...extra,
    },
  } satisfies SyntheticTakeOptions;
}

async function expectStandardMp4(path: string, durationSec: number): Promise<void> {
  const media = await probeMedia(path);
  expect(media.formatName).toContain('mp4');
  expect(media.streams.length).toBe(2);
  expect(media.video.length).toBe(1);
  expect(media.audio.length).toBe(1);

  const video = media.video[0]!;
  expect(video.codecName).toBe('h264');
  expect(video.pixelFormat).toBe('yuv420p');
  expect(video.frameRate).toBe(30);
  expect(Math.abs(video.startTimeSec)).toBeLessThan(FRAME_SEC);
  // The picture starts at zero by itself, not only through the MP4 edit list.
  expect(await videoStartIgnoringEditList(path)).toEqual({ startPts: 0, hasBFrames: 0 });

  const audio = media.audio[0]!;
  expect(audio.codecName).toBe('aac');
  expect(audio.sampleRate).toBe(48000);
  expect(audio.channels).toBe(2);

  expect(Math.abs(video.durationSec - durationSec)).toBeLessThan(DURATION_TOLERANCE_SEC);
  expect(Math.abs(audio.durationSec - durationSec)).toBeLessThan(DURATION_TOLERANCE_SEC);
  expect(Math.abs(video.durationSec - audio.durationSec)).toBeLessThan(DURATION_TOLERANCE_SEC);

  // faststart: the index (moov) comes before the media data (mdat).
  const boxes = await topLevelMp4Boxes(path);
  expect(boxes).toContain('moov');
  expect(boxes).toContain('mdat');
  expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));
}

describe('exportTake: video takes', () => {
  it.each<[VideoFlavour, Partial<SyntheticTakeOptions['video']>]>([
    // Irregular frame timing and a first timestamp that is not zero, like a real recording.
    ['webm-vp8', { dropEveryNthFrame: 7, firstTimestampSec: 0.7 }],
    ['webm-vp9', { dropEveryNthFrame: 5 }],
    ['webm-h264', { dropEveryNthFrame: 7, firstTimestampSec: 0.25 }],
    ['mkv-h264', {}],
    ['mp4-h264', { dropEveryNthFrame: 6 }],
  ])('exports a %s recording as a standard, correctly synchronised MP4', async (flavour, extra) => {
    const { takeDir } = await makeTake(smallVideoTake(flavour, extra));
    const outputPath = join(await makeOutputDir(), 'My Take.mp4');

    const result = expectOk(await exportTake({ takeDir, outputPath, ffmpegPath }));

    expect(result.outputPath).toBe(outputPath);
    expect(result.durationSec).toBe(3);
    expect(result.sizeBytes).toBe((await stat(outputPath)).size);
    await expectStandardMp4(outputPath, 3);

    // Audio: the vocal clicks (left) and backing clicks (right) were recorded 30 ms apart
    // and 0.4 s after the audio clock started; both must come out at 0.5, 1.0 and 2.0 s.
    const audio = await decodeAudio(outputPath);
    expectClose(findClickTimes(audio.left, audio.sampleRate), [0.5, 1.0, 2.0], CLICK_TOLERANCE_SEC);
    expectClose(
      findClickTimes(audio.right, audio.sampleRate),
      [0.5, 1.0, 2.0],
      CLICK_TOLERANCE_SEC,
    );

    // Video: the flash shown 1.0 s into the recording is still at 1.0 s (frame 30),
    // i.e. the picture was neither shifted nor retimed, whatever its original timestamps.
    const brightness = await frameBrightness(outputPath);
    expect(brightness.length).toBe(90);
    const firstBrightFrame = brightness.findIndex((value) => value > 200);
    expect(Math.abs(firstBrightFrame - 30)).toBeLessThanOrEqual(1);

    // The take is untouched (so a failed save can be retried) and no temp files remain.
    const takeFiles = await readdir(takeDir);
    expect(takeFiles).toContain(MANIFEST_FILE);
    expect(takeFiles).not.toContain('mix.wav');
    expect(await readdir(join(outputPath, '..'))).toEqual(['My Take.mp4']);
  });

  it('pads the audio with silence when the video started before the audio', async () => {
    const { takeDir } = await makeTake({
      stemSec: 4,
      vocalLatencySec: 0.045,
      clickTimesSec: [0.2, 1.5],
      video: { flavour: 'mkv-h264', width: 320, height: 240, durationSec: 3, startOffsetSec: -0.3 },
    });
    const outputPath = join(await makeOutputDir(), 'early-video.mp4');
    expectOk(await exportTake({ takeDir, outputPath, ffmpegPath }));

    await expectStandardMp4(outputPath, 3);
    const audio = await decodeAudio(outputPath);
    expectClose(findClickTimes(audio.left, audio.sampleRate), [0.5, 1.8], CLICK_TOLERANCE_SEC);
    expectClose(findClickTimes(audio.right, audio.sampleRate), [0.5, 1.8], CLICK_TOLERANCE_SEC);
  });

  it('holds the last frame when the recording is shorter than the take says', async () => {
    const options = smallVideoTake('mkv-h264');
    const { takeDir, manifest } = await makeTake({
      ...options,
      video: { ...options.video, durationSec: 2 },
    });
    // The manifest claims 3 s although only 2 s of video were recorded.
    const longerManifest: TakeManifest = {
      ...manifest,
      video: { ...manifest.video!, durationSec: 3 },
    };
    await writeFile(join(takeDir, MANIFEST_FILE), JSON.stringify(longerManifest));

    const outputPath = join(await makeOutputDir(), 'short-video.mp4');
    expectOk(await exportTake({ takeDir, outputPath, ffmpegPath }));
    await expectStandardMp4(outputPath, 3);
  });

  it('works with the software encoder', async () => {
    const { takeDir } = await makeTake(smallVideoTake('webm-vp8'));
    const outputPath = join(await makeOutputDir(), 'software.mp4');
    expectOk(await exportTake({ takeDir, outputPath, ffmpegPath, videoEncoders: [SOFTWARE_H264] }));
    await expectStandardMp4(outputPath, 3);
  });

  it('falls back to the next encoder when one fails at run time', async () => {
    const brokenEncoder: VideoEncoder = {
      name: 'broken',
      outputArgs: () => ['-c:v', 'h264_encoder_that_does_not_exist'],
    };
    const { takeDir } = await makeTake(smallVideoTake('webm-vp8'));
    const outputPath = join(await makeOutputDir(), 'fallback.mp4');
    const fractions: number[] = [];

    expectOk(
      await exportTake({
        takeDir,
        outputPath,
        ffmpegPath,
        videoEncoders: [brokenEncoder, SOFTWARE_H264],
        onProgress: (progress) => fractions.push(progress.fraction),
      }),
    );

    await expectStandardMp4(outputPath, 3);
    for (let index = 1; index < fractions.length; index++) {
      expect(fractions[index]!).toBeGreaterThanOrEqual(fractions[index - 1]!);
    }
  });

  it('reports export-failed with the FFmpeg error when every encoder fails', async () => {
    const brokenEncoder: VideoEncoder = {
      name: 'broken',
      outputArgs: () => ['-c:v', 'h264_encoder_that_does_not_exist'],
    };
    const { takeDir } = await makeTake(smallVideoTake('webm-vp8'));
    const outputDir = await makeOutputDir();
    const result = await exportTake({
      takeDir,
      outputPath: join(outputDir, 'never.mp4'),
      ffmpegPath,
      videoEncoders: [brokenEncoder],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'export-failed' } });
    if (!result.ok) expect(result.error.detail).toMatch(/h264_encoder_that_does_not_exist/);
    expect(await readdir(outputDir)).toEqual([]);
    expect(await readdir(takeDir)).not.toContain('mix.wav');
  });

  it('reports export-failed for a recording FFmpeg cannot read, leaving nothing behind', async () => {
    const { takeDir } = await makeTake(smallVideoTake('webm-vp8'));
    await writeFile(join(takeDir, 'video.webm'), 'this is not a video');
    const outputDir = await makeOutputDir();

    const result = await exportTake({ takeDir, outputPath: join(outputDir, 'x.mp4'), ffmpegPath });

    expect(result).toMatchObject({ ok: false, error: { code: 'export-failed' } });
    if (!result.ok) {
      expect(result.error.message).toMatch(/could not be saved/);
      expect(result.error.detail).toMatch(/Invalid data|EBML|video\.webm/);
    }
    expect(await readdir(outputDir)).toEqual([]);
  });

  it('reports the stages in order with progress that only moves forward', async () => {
    // Large enough that FFmpeg reports progress several times while encoding.
    const { takeDir } = await makeTake({
      stemSec: 13,
      vocalLatencySec: 0.03,
      clickTimesSec: [1],
      video: { flavour: 'mkv-h264', width: 1280, height: 720, durationSec: 12, startOffsetSec: 0 },
    });
    const outputPath = join(await makeOutputDir(), 'progress.mp4');
    const events: ExportStageProgress[] = [];

    expectOk(
      await exportTake({
        takeDir,
        outputPath,
        ffmpegPath,
        videoEncoders: [SOFTWARE_H264],
        onProgress: (event) => events.push(event),
      }),
    );

    const stages = events.map((event) => event.stage);
    const firstOf = (stage: ExportStage): number => stages.indexOf(stage);
    const lastOf = (stage: ExportStage): number => stages.lastIndexOf(stage);
    expect(firstOf('mixing')).toBe(0);
    expect(lastOf('mixing')).toBeLessThan(firstOf('encoding'));
    expect(lastOf('encoding')).toBeLessThan(firstOf('finishing'));
    expect(events[0]!.fraction).toBe(0);
    expect(events.at(-1)).toEqual({ stage: 'finishing', fraction: 1 });
    for (let index = 1; index < events.length; index++) {
      expect(events[index]!.fraction).toBeGreaterThanOrEqual(events[index - 1]!.fraction);
    }
    // Encoding really reported intermediate progress from FFmpeg, not just its two ends.
    expect(stages.filter((stage) => stage === 'encoding').length).toBeGreaterThan(2);
  });

  it('replaces an existing file at the destination', async () => {
    const { takeDir } = await makeTake(smallVideoTake('mkv-h264'));
    const outputPath = join(await makeOutputDir(), 'again.mp4');
    await writeFile(outputPath, 'an older export');
    const result = expectOk(await exportTake({ takeDir, outputPath, ffmpegPath }));
    expect(result.sizeBytes).toBeGreaterThan(10_000);
    await expectStandardMp4(outputPath, 3);
  });
});

describe('exportTake: audio-only takes', () => {
  const audioTake: SyntheticTakeOptions = {
    stemSec: 3,
    vocalLatencySec: 0.025,
    clickTimesSec: [0.5, 1.25, 2.5],
  };

  async function expectStillMp4(path: string, durationSec: number): Promise<void> {
    const media = await probeMedia(path);
    expect(media.video.length).toBe(1);
    expect(media.audio.length).toBe(1);
    const video = media.video[0]!;
    expect(video.codecName).toBe('h264');
    expect(video.pixelFormat).toBe('yuv420p');
    expect(video.width).toBe(1920);
    expect(video.height).toBe(1080);
    expect(video.frameRate).toBe(10);
    const audio = media.audio[0]!;
    expect(audio.codecName).toBe('aac');
    expect(audio.sampleRate).toBe(48000);
    expect(audio.channels).toBe(2);
    expect(Math.abs(audio.durationSec - durationSec)).toBeLessThan(DURATION_TOLERANCE_SEC);
    // At 10 fps the picture track can only match the audio to the nearest frame.
    expect(Math.abs(video.durationSec - durationSec)).toBeLessThan(0.1 + 0.001);
    expect(await videoStartIgnoringEditList(path)).toEqual({ startPts: 0, hasBFrames: 0 });
    const boxes = await topLevelMp4Boxes(path);
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));
  }

  it('exports with the built-in dark frame when there is no artwork', async () => {
    const { takeDir } = await makeTake(audioTake);
    const outputPath = join(await makeOutputDir(), 'audio-only.mp4');

    const result = expectOk(await exportTake({ takeDir, outputPath, ffmpegPath }));

    // The audio ends where the latency-shifted vocal runs out.
    expect(result.durationSec).toBeCloseTo(3 - 0.025, 6);
    await expectStillMp4(outputPath, 2.975);
    const audio = await decodeAudio(outputPath);
    expectClose(
      findClickTimes(audio.left, audio.sampleRate),
      [0.5, 1.25, 2.5],
      CLICK_TOLERANCE_SEC,
    );
    expectClose(
      findClickTimes(audio.right, audio.sampleRate),
      [0.5, 1.25, 2.5],
      CLICK_TOLERANCE_SEC,
    );

    const brightness = await frameBrightness(outputPath);
    expect(Math.max(...brightness)).toBeLessThan(30);
    expect(await readdir(takeDir)).not.toContain('mix.wav');
  });

  it('shows the provided artwork, fitted into 1920x1080 without distortion', async () => {
    const { takeDir } = await makeTake(audioTake);
    const outputPath = join(await makeOutputDir(), 'with-artwork.mp4');
    // A white square: fills the 1080-pixel height, leaving dark bars left and right.
    const artworkPng = await makePng(600, 600, 'white');

    expectOk(await exportTake({ takeDir, outputPath, ffmpegPath, artworkPng }));

    await expectStillMp4(outputPath, 2.975);
    const brightness = await frameBrightness(outputPath);
    const expectedMean = 235 * (1080 / 1920) + 8 * (1 - 1080 / 1920);
    for (const value of [brightness[0]!, brightness.at(-1)!]) {
      expect(Math.abs(value - expectedMean)).toBeLessThan(25);
    }
    expect(await readdir(takeDir)).not.toContain('artwork.png');
  });

  it('reads the artwork from a take folder whose path looks like an image-sequence pattern', async () => {
    // Exactly one pattern: FFmpeg treats a path with two as a plain file name.
    const takeDir = join(root, `user%03d-${++takeCounter}`, 'takes');
    await mkdir(takeDir, { recursive: true });
    await writeSyntheticTake(takeDir, audioTake);
    const outputPath = join(await makeOutputDir(), 'pattern-path.mp4');

    expectOk(
      await exportTake({
        takeDir,
        outputPath,
        ffmpegPath,
        artworkPng: await makePng(64, 64, 'white'),
      }),
    );

    await expectStillMp4(outputPath, 2.975);
    expect(Math.max(...(await frameBrightness(outputPath)))).toBeGreaterThan(30);
  });

  it('resamples a 44.1 kHz take to 48 kHz AAC', async () => {
    const { takeDir } = await makeTake({ ...audioTake, sampleRate: 44100 });
    const outputPath = join(await makeOutputDir(), 'cd-rate.mp4');
    expectOk(await exportTake({ takeDir, outputPath, ffmpegPath }));

    await expectStillMp4(outputPath, 2.975);
    const audio = await decodeAudio(outputPath);
    expectClose(
      findClickTimes(audio.left, audio.sampleRate),
      [0.5, 1.25, 2.5],
      CLICK_TOLERANCE_SEC,
    );
  });

  it('rejects artwork that is not a PNG before doing any work', async () => {
    const { takeDir } = await makeTake(audioTake);
    const outputDir = await makeOutputDir();
    const result = await exportTake({
      takeDir,
      outputPath: join(outputDir, 'x.mp4'),
      ffmpegPath,
      artworkPng: new TextEncoder().encode('<svg></svg>'),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'export-failed' } });
    expect(await readdir(outputDir)).toEqual([]);
  });
});

describe('exportTake: cancellation and destinations', () => {
  it('names the temporary file after the destination, with a token that keeps it unique', () => {
    expect(partialOutputPath(join('/Movies', 'My Take.mp4'), 'a1b2c3d4')).toBe(
      join('/Movies', 'My Take.a1b2c3d4.partial.mp4'),
    );
  });

  it('writes to a "<name>.<token>.partial.mp4" file while encoding, never to the final name', async () => {
    const { takeDir } = await makeTake({ stemSec: 20, vocalLatencySec: 0, clickTimesSec: [1] });
    const outputDir = await makeOutputDir();
    const namesSeenWhileEncoding = new Set<string>();

    expectOk(
      await exportTake({
        takeDir,
        outputPath: join(outputDir, 'song.mp4'),
        ffmpegPath,
        onProgress: ({ stage, fraction }) => {
          if (stage !== 'encoding' || fraction < 0.2) return;
          for (const name of readdirSync(outputDir)) namesSeenWhileEncoding.add(name);
        },
      }),
    );

    expect(namesSeenWhileEncoding.size).toBe(1);
    expect([...namesSeenWhileEncoding][0]).toMatch(/^song\.[0-9a-f]{8}\.partial\.mp4$/);
    expect(await readdir(outputDir)).toEqual(['song.mp4']);
  });

  it.each<ExportStage>(['mixing', 'encoding'])(
    'cancelling during %s reports export-cancelled and leaves no partial file',
    async (stageToCancelIn) => {
      // Long enough that neither stage can finish before the cancel takes effect.
      const { takeDir } = await makeTake({
        stemSec: 60,
        vocalLatencySec: 0.02,
        clickTimesSec: [1],
      });
      const outputDir = await makeOutputDir();
      const outputPath = join(outputDir, 'cancelled.mp4');
      const controller = new AbortController();
      const stagesSeen = new Set<ExportStage>();

      const result = await exportTake({
        takeDir,
        outputPath,
        ffmpegPath,
        signal: controller.signal,
        onProgress: ({ stage, fraction }) => {
          stagesSeen.add(stage);
          if (stage === stageToCancelIn && fraction > (stage === 'mixing' ? 0.03 : 0.15)) {
            controller.abort();
          }
        },
      });

      expect(result).toMatchObject({ ok: false, error: { code: 'export-cancelled' } });
      expect(stagesSeen.has('finishing')).toBe(false);
      // Neither the finished file nor the "<name>.<token>.partial.mp4" it was written as.
      expect(await readdir(outputDir)).toEqual([]);
      const takeFiles = await readdir(takeDir);
      expect(takeFiles).not.toContain('mix.wav');
      expect(takeFiles).toContain(MANIFEST_FILE);

      // The take is intact: the same export succeeds afterwards.
      const retry = await exportTake({ takeDir, outputPath, ffmpegPath });
      expect(retry.ok).toBe(true);
    },
  );

  it('does not start when the signal is already aborted', async () => {
    const { takeDir } = await makeTake({ stemSec: 1, vocalLatencySec: 0, clickTimesSec: [0.5] });
    const outputDir = await makeOutputDir();
    const result = await exportTake({
      takeDir,
      outputPath: join(outputDir, 'x.mp4'),
      ffmpegPath,
      signal: AbortSignal.abort(),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'export-cancelled' } });
    expect(await readdir(outputDir)).toEqual([]);
  });

  it('leaves a file of the user that happens to be called "<name>.partial.mp4" alone', async () => {
    const { takeDir } = await makeTake({ stemSec: 1, vocalLatencySec: 0, clickTimesSec: [0.5] });
    const outputDir = await makeOutputDir();
    const usersFile = join(outputDir, 'song.partial.mp4');
    await writeFile(usersFile, 'not ours to touch');

    // A successful export, a failed one and a cancelled one: none may replace or remove it.
    expectOk(await exportTake({ takeDir, outputPath: join(outputDir, 'song.mp4'), ffmpegPath }));
    const failed = await exportTake({
      takeDir,
      outputPath: join(outputDir, 'song.mp4'),
      ffmpegPath: join(root, 'no-such-ffmpeg'),
    });
    expect(failed).toMatchObject({ ok: false, error: { code: 'export-failed' } });
    const cancelled = await exportTake({
      takeDir,
      outputPath: join(outputDir, 'song.mp4'),
      ffmpegPath,
      signal: AbortSignal.abort(),
    });
    expect(cancelled).toMatchObject({ ok: false, error: { code: 'export-cancelled' } });

    expect((await readdir(outputDir)).sort()).toEqual(['song.mp4', 'song.partial.mp4']);
    expect(await readFile(usersFile, 'utf8')).toBe('not ours to touch');
  });

  it('reports output-folder-unavailable for a folder that does not exist', async () => {
    const { takeDir } = await makeTake({ stemSec: 1, vocalLatencySec: 0, clickTimesSec: [0.5] });
    const result = await exportTake({
      takeDir,
      outputPath: join(root, 'unplugged-drive', 'take.mp4'),
      ffmpegPath,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'output-folder-unavailable' } });
    if (!result.ok) expect(result.error.message).toMatch(/folder is not available/);
    expect(await readdir(takeDir)).not.toContain('mix.wav');
  });

  it('reports output-folder-unavailable for a folder that cannot be written to', async () => {
    const { takeDir } = await makeTake({ stemSec: 1, vocalLatencySec: 0, clickTimesSec: [0.5] });
    const readOnlyDir = await makeOutputDir();
    await chmod(readOnlyDir, 0o500);
    try {
      const result = await exportTake({
        takeDir,
        outputPath: join(readOnlyDir, 'take.mp4'),
        ffmpegPath,
      });
      expect(result).toMatchObject({ ok: false, error: { code: 'output-folder-unavailable' } });
      expect(await readdir(readOnlyDir)).toEqual([]);
    } finally {
      await chmod(readOnlyDir, 0o700);
    }
  });

  it('reports output-folder-unavailable when a file is where the folder should be', async () => {
    const { takeDir } = await makeTake({ stemSec: 1, vocalLatencySec: 0, clickTimesSec: [0.5] });
    const notAFolder = join(await makeOutputDir(), 'file.txt');
    await writeFile(notAFolder, 'x');
    const result = await exportTake({
      takeDir,
      outputPath: join(notAFolder, 'take.mp4'),
      ffmpegPath,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'output-folder-unavailable' } });
  });

  it('reports export-failed for a folder that is not a finished take', async () => {
    const emptyDir = await makeOutputDir();
    const result = await exportTake({
      takeDir: emptyDir,
      outputPath: join(await makeOutputDir(), 'x.mp4'),
      ffmpegPath,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'export-failed' } });
  });

  it('reports export-failed when FFmpeg itself cannot be started', async () => {
    const { takeDir } = await makeTake({ stemSec: 1, vocalLatencySec: 0, clickTimesSec: [0.5] });
    const outputDir = await makeOutputDir();
    const result = await exportTake({
      takeDir,
      outputPath: join(outputDir, 'x.mp4'),
      ffmpegPath: join(root, 'no-such-ffmpeg'),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'export-failed' } });
    if (!result.ok) expect(result.error.detail).toMatch(/ENOENT/);
    expect(await readdir(outputDir)).toEqual([]);
  });
});

describe('video encoders', () => {
  it('picks about 6 Mbit/s for 720p and 12 Mbit/s for 1080p, within sane limits', () => {
    expect(videoBitrateKbps(1280, 720)).toBe(6000);
    expect(videoBitrateKbps(1920, 1080)).toBe(12_000);
    expect(videoBitrateKbps(640, 360)).toBeGreaterThanOrEqual(1500);
    expect(videoBitrateKbps(640, 360)).toBeLessThan(6000);
    expect(videoBitrateKbps(16, 16)).toBe(1500);
    expect(videoBitrateKbps(7680, 4320)).toBe(40_000);
  });

  it('probes the hardware encoder once per binary and reports false for a missing binary', async () => {
    const first = isHardwareEncoderUsable(ffmpegPath);
    expect(isHardwareEncoderUsable(ffmpegPath)).toBe(first);
    expect(typeof (await first)).toBe('boolean');
    expect(await isHardwareEncoderUsable(join(root, 'no-such-ffmpeg'))).toBe(false);
  });

  it('exports ten seconds of 1080p and reports how long each encoder takes', async () => {
    const { takeDir } = await makeTake({
      stemSec: 11,
      vocalLatencySec: 0.03,
      clickTimesSec: [1, 5, 9],
      video: {
        flavour: 'webm-h264',
        width: 1920,
        height: 1080,
        durationSec: 10,
        startOffsetSec: 0.2,
      },
    });
    const hardwareUsable = await isHardwareEncoderUsable(ffmpegPath);
    process.stdout.write(`    h264_videotoolbox usable on this machine: ${hardwareUsable}\n`);

    const encoders = hardwareUsable ? [HARDWARE_H264, SOFTWARE_H264] : [SOFTWARE_H264];
    for (const encoder of encoders) {
      const outputPath = join(await makeOutputDir(), `${encoder.name}.mp4`);
      const startedAt = performance.now();
      const result = expectOk(
        await exportTake({ takeDir, outputPath, ffmpegPath, videoEncoders: [encoder] }),
      );
      const elapsedSec = (performance.now() - startedAt) / 1000;
      process.stdout.write(
        `    1080p 10 s export with ${encoder.name}: ${elapsedSec.toFixed(2)} s ` +
          `(${(10 / elapsedSec).toFixed(1)}x realtime, ${(result.sizeBytes / 1e6).toFixed(1)} MB)\n`,
      );

      await expectStandardMp4(outputPath, 10);
      const media = await probeMedia(outputPath);
      expect(media.video[0]!.width).toBe(1920);
      expect(media.video[0]!.height).toBe(1080);
      expect(elapsedSec).toBeLessThan(45);
    }
  });
});
