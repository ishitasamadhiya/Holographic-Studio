// Synthetic takes and media inspection shared by the export unit tests (vitest) and the
// end-to-end tests (Playwright). Everything is generated with the bundled FFmpeg, so no
// binary fixtures are checked in.
import { execFile } from 'node:child_process';
import { open, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  BACKING_STEM_FILE,
  MANIFEST_FILE,
  VOCAL_STEM_FILE,
} from '../../../src/main/takes/takeFiles';
import { STEM_CHANNELS, type TakeManifest } from '../../../src/shared/take';

const run = promisify(execFile);
const nodeRequire = createRequire(__filename);

export const ffmpegPath = nodeRequire('ffmpeg-static') as string;
export const ffprobePath = (nodeRequire('ffprobe-static') as { path: string }).path;

const MAX_TOOL_OUTPUT_BYTES = 1024 * 1024 * 1024;

// ---------------------------------------------------------------------------------------
// Audio: click stems
// ---------------------------------------------------------------------------------------

/** Low enough that the exporter's loudness boost (at most +12 dB) never reaches the limiter. */
const CLICK_AMPLITUDE = 0.2;
const CLICK_SEC = 0.002;
const CLICK_FREQUENCY_HZ = 3000;

/**
 * Silent interleaved-stereo stem with a short tone burst centred on each given time, in one
 * channel only (0 = left, 1 = right), so the two stems can be told apart after mixing.
 */
export function clickStem(
  sampleRate: number,
  frames: number,
  clickTimesSec: readonly number[],
  channel: 0 | 1,
): Float32Array {
  const samples = new Float32Array(frames * STEM_CHANNELS);
  const halfLength = Math.round((CLICK_SEC * sampleRate) / 2);
  for (const timeSec of clickTimesSec) {
    const centre = Math.round(timeSec * sampleRate);
    for (let offset = -halfLength; offset <= halfLength; offset++) {
      const frame = centre + offset;
      if (frame < 0 || frame >= frames) continue;
      const hannWindow = 0.5 * (1 + Math.cos((Math.PI * offset) / halfLength));
      const tone = Math.cos((2 * Math.PI * CLICK_FREQUENCY_HZ * offset) / sampleRate);
      samples[frame * STEM_CHANNELS + channel] = CLICK_AMPLITUDE * hannWindow * tone;
    }
  }
  return samples;
}

/** Times (seconds) of the centre of every burst in one channel of decoded audio. */
export function findClickTimes(channelSamples: Float32Array, sampleRate: number): number[] {
  let peak = 0;
  for (const sample of channelSamples) peak = Math.max(peak, Math.abs(sample));
  if (peak === 0) return [];

  const threshold = peak * 0.25;
  const maxGapFrames = Math.round(0.01 * sampleRate);
  const times: number[] = [];
  let weightedSum = 0;
  let weight = 0;
  let lastLoudFrame = -Infinity;

  const closeBurst = (): void => {
    if (weight > 0) times.push(weightedSum / weight / sampleRate);
    weightedSum = 0;
    weight = 0;
  };
  for (let frame = 0; frame < channelSamples.length; frame++) {
    const energy = channelSamples[frame]! ** 2;
    if (Math.abs(channelSamples[frame]!) < threshold) continue;
    if (frame - lastLoudFrame > maxGapFrames) closeBurst();
    weightedSum += frame * energy;
    weight += energy;
    lastLoudFrame = frame;
  }
  closeBurst();
  return times;
}

// ---------------------------------------------------------------------------------------
// Video: test recordings in the containers MediaRecorder produces
// ---------------------------------------------------------------------------------------

/**
 * The container/codec pairs Chromium's MediaRecorder can hand us:
 *   webm-vp8, webm-vp9   video/webm;codecs=vp8|vp9
 *   webm-h264            video/webm;codecs=h264 (really Matroska with H.264 inside)
 *   mkv-h264             video/x-matroska;codecs=avc1
 *   mp4-h264             video/mp4;codecs=avc1 (fragmented MP4)
 */
export type VideoFlavour = 'webm-vp8' | 'webm-vp9' | 'webm-h264' | 'mkv-h264' | 'mp4-h264';

const VIDEO_FLAVOURS: Record<VideoFlavour, { fileName: string; encodeArgs: string[] }> = {
  'webm-vp8': {
    fileName: 'video.webm',
    encodeArgs: [
      '-c:v',
      'libvpx',
      '-b:v',
      '1M',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-f',
      'webm',
    ],
  },
  'webm-vp9': {
    fileName: 'video.webm',
    encodeArgs: [
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '1M',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-f',
      'webm',
    ],
  },
  'webm-h264': {
    fileName: 'video.webm',
    encodeArgs: [
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'matroska',
    ],
  },
  'mkv-h264': {
    fileName: 'video.mkv',
    encodeArgs: [
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'matroska',
    ],
  },
  'mp4-h264': {
    fileName: 'video.mp4',
    encodeArgs: [
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+frag_keyframe+empty_moov+default_base_moof',
      '-f',
      'mp4',
    ],
  },
};

export interface TestVideoOptions {
  flavour: VideoFlavour;
  width: number;
  height: number;
  durationSec: number;
  frameRate?: number;
  /** Timestamp of the first frame in the file. Real recordings do not always start at zero. */
  firstTimestampSec?: number;
  /** Drops every Nth frame, leaving the irregular frame timing of a real camera. */
  dropEveryNthFrame?: number;
  /** Shows a full white frame for 0.1 s starting this long after the first frame. */
  flashAtSec?: number;
}

/** Writes a test-pattern recording into `takeDir` and returns its path. */
export async function writeTestVideo(takeDir: string, options: TestVideoOptions): Promise<string> {
  const { flavour, width, height, durationSec } = options;
  const frameRate = options.frameRate ?? 30;
  const filters: string[] = [];
  if (options.flashAtSec !== undefined) {
    const from = options.flashAtSec;
    const to = from + 0.1 - 0.001;
    filters.push(`drawbox=enable='between(t\\,${from}\\,${to})':color=white:t=fill`);
  }
  if (options.dropEveryNthFrame) {
    filters.push(`select='not(eq(mod(n\\,${options.dropEveryNthFrame})\\,3))'`);
  }
  if (options.firstTimestampSec) filters.push(`setpts=PTS+${options.firstTimestampSec}/TB`);

  const { fileName, encodeArgs } = VIDEO_FLAVOURS[flavour];
  const outputPath = join(takeDir, fileName);
  await run(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=${width}x${height}:r=${frameRate}:d=${durationSec}`,
    ...(filters.length > 0 ? ['-vf', filters.join(',')] : []),
    '-fps_mode',
    'vfr',
    '-an',
    ...encodeArgs,
    outputPath,
  ]);
  return outputPath;
}

/** A solid-colour PNG, e.g. as artwork for an audio-only export. */
export async function makePng(width: number, height: number, color = 'white'): Promise<Uint8Array> {
  const { stdout } = await run(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:s=${width}x${height}`,
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-c:v',
      'png',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: MAX_TOOL_OUTPUT_BYTES },
  );
  return new Uint8Array(stdout);
}

// ---------------------------------------------------------------------------------------
// Whole takes
// ---------------------------------------------------------------------------------------

export interface SyntheticTakeOptions {
  sampleRate?: number;
  /** Length of both stems. */
  stemSec: number;
  vocalLatencySec: number;
  /**
   * When (on the stem clock) the singer heard each backing click. The backing stem gets a
   * click in its right channel at each time; the vocal stem gets the singer's perfectly
   * timed reply in its left channel one vocal latency later.
   */
  clickTimesSec: readonly number[];
  /** Present for a video take. */
  video?: TestVideoOptions & {
    /** Capture time of the first video frame on the stem clock. */
    startOffsetSec: number;
  };
}

/** Builds a finished take folder (stems, manifest and optionally a recording) in `takeDir`. */
export async function writeSyntheticTake(
  takeDir: string,
  options: SyntheticTakeOptions,
): Promise<TakeManifest> {
  const sampleRate = options.sampleRate ?? 48000;
  const frames = Math.round(options.stemSec * sampleRate);
  const vocalClickTimes = options.clickTimesSec.map((time) => time + options.vocalLatencySec);
  const vocal = clickStem(sampleRate, frames, vocalClickTimes, 0);
  const backing = clickStem(sampleRate, frames, options.clickTimesSec, 1);
  await writeFile(join(takeDir, VOCAL_STEM_FILE), new Uint8Array(vocal.buffer));
  await writeFile(join(takeDir, BACKING_STEM_FILE), new Uint8Array(backing.buffer));

  const manifest: TakeManifest = {
    mode: options.video ? 'video' : 'audio',
    sampleRate,
    audioFrames: frames,
    vocalLatencySec: options.vocalLatencySec,
    hasBacking: true,
  };
  if (options.video) {
    await writeTestVideo(takeDir, options.video);
    manifest.video = {
      startOffsetSec: options.video.startOffsetSec,
      durationSec: options.video.durationSec,
      width: options.video.width,
      height: options.video.height,
      frameRate: options.video.frameRate ?? 30,
    };
  }
  await writeFile(join(takeDir, MANIFEST_FILE), JSON.stringify(manifest));
  return manifest;
}

// ---------------------------------------------------------------------------------------
// Inspecting exported files
// ---------------------------------------------------------------------------------------

export interface ProbedStream {
  codecType: 'video' | 'audio' | string;
  codecName: string;
  durationSec: number;
  startTimeSec: number;
  frameCount: number;
  /** Video only. */
  pixelFormat?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  /** Audio only. */
  sampleRate?: number;
  channels?: number;
}

export interface ProbedMedia {
  formatName: string;
  durationSec: number;
  streams: ProbedStream[];
  video: ProbedStream[];
  audio: ProbedStream[];
}

function parseRatio(ratio: string | undefined): number {
  const [numerator, denominator] = (ratio ?? '').split('/').map(Number);
  return numerator && denominator ? numerator / denominator : Number.NaN;
}

interface RawProbe {
  format: { format_name: string; duration?: string };
  streams: Array<Record<string, string | number | undefined>>;
}

/** Container and stream facts as reported by ffprobe. */
export async function probeMedia(path: string): Promise<ProbedMedia> {
  const { stdout } = await run(ffprobePath, [
    '-v',
    'error',
    '-show_format',
    '-show_streams',
    '-of',
    'json',
    path,
  ]);
  const raw = JSON.parse(stdout) as RawProbe;
  const streams = raw.streams.map((stream): ProbedStream => {
    const common = {
      codecType: String(stream.codec_type),
      codecName: String(stream.codec_name),
      durationSec: Number(stream.duration),
      startTimeSec: Number(stream.start_time),
      frameCount: Number(stream.nb_frames),
    };
    return stream.codec_type === 'video'
      ? {
          ...common,
          pixelFormat: String(stream.pix_fmt),
          width: Number(stream.width),
          height: Number(stream.height),
          frameRate: parseRatio(String(stream.avg_frame_rate)),
        }
      : { ...common, sampleRate: Number(stream.sample_rate), channels: Number(stream.channels) };
  });
  return {
    formatName: raw.format.format_name,
    durationSec: Number(raw.format.duration),
    streams,
    video: streams.filter((stream) => stream.codecType === 'video'),
    audio: streams.filter((stream) => stream.codecType === 'audio'),
  };
}

/**
 * The first video timestamp of an MP4 as a player that ignores edit lists sees it, and
 * whether the stream uses B-frames (which delay that timestamp unless an edit list fixes it).
 */
export async function videoStartIgnoringEditList(
  path: string,
): Promise<{ startPts: number; hasBFrames: number }> {
  const { stdout } = await run(ffprobePath, [
    '-v',
    'error',
    '-ignore_editlist',
    '1',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=start_pts,has_b_frames',
    '-of',
    'json',
    path,
  ]);
  const stream = (JSON.parse(stdout) as Pick<RawProbe, 'streams'>).streams[0];
  return { startPts: Number(stream?.start_pts), hasBFrames: Number(stream?.has_b_frames) };
}

/** Presentation times (seconds) of every video frame in a file, in order. */
export async function videoFrameTimes(path: string): Promise<number[]> {
  const { stdout } = await run(
    ffprobePath,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'packet=pts_time',
      '-of',
      'csv=p=0',
      path,
    ],
    { maxBuffer: MAX_TOOL_OUTPUT_BYTES },
  );
  return stdout
    .split('\n')
    .map((line) => Number.parseFloat(line))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
}

export interface DecodedAudio {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

/** Decodes a file's audio track to 48 kHz stereo floats. */
export async function decodeAudio(path: string): Promise<DecodedAudio> {
  const sampleRate = 48000;
  const { stdout } = await run(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-ac',
      '2',
      '-ar',
      String(sampleRate),
      '-f',
      'f32le',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: MAX_TOOL_OUTPUT_BYTES },
  );
  const interleaved = new Float32Array(new Uint8Array(stdout).buffer);
  const frames = Math.floor(interleaved.length / 2);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    left[frame] = interleaved[frame * 2]!;
    right[frame] = interleaved[frame * 2 + 1]!;
  }
  return { sampleRate, left, right };
}

/** Average brightness (0..255) of every video frame, decoded at 30 fps. */
export async function frameBrightness(path: string): Promise<number[]> {
  const size = 8;
  const { stdout } = await run(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path,
      '-map',
      '0:v:0',
      '-vf',
      `scale=${size}:${size},format=gray`,
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: MAX_TOOL_OUTPUT_BYTES },
  );
  const frameBytes = size * size;
  const brightness: number[] = [];
  for (let offset = 0; offset + frameBytes <= stdout.length; offset += frameBytes) {
    let sum = 0;
    for (let index = 0; index < frameBytes; index++) sum += stdout[offset + index]!;
    brightness.push(sum / frameBytes);
  }
  return brightness;
}

/** Names of the top-level boxes of an MP4 file, in file order (e.g. ftyp, moov, mdat). */
export async function topLevelMp4Boxes(path: string): Promise<string[]> {
  const handle = await open(path, 'r');
  try {
    const { size: fileSize } = await handle.stat();
    const header = Buffer.alloc(16);
    const boxes: string[] = [];
    let offset = 0;
    while (offset + 8 <= fileSize) {
      await handle.read(header, 0, 16, offset);
      let boxSize = header.readUInt32BE(0);
      boxes.push(header.toString('ascii', 4, 8));
      if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8));
      if (boxSize === 0) break;
      offset += boxSize;
    }
    return boxes;
  } finally {
    await handle.close();
  }
}
