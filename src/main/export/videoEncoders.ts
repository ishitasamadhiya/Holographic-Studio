import { runFfmpeg } from './ffmpegProcess';

/** One way of producing H.264 with FFmpeg. */
export interface VideoEncoder {
  name: string;
  /** Output options that select and configure the encoder for the given target bitrate. */
  outputArgs(bitrateKbps: number): string[];
}

/** Apple's hardware encoder: several times faster than software at 1080p and easy on the battery. */
export const HARDWARE_H264: VideoEncoder = {
  name: 'h264_videotoolbox',
  outputArgs: (bitrateKbps) => [
    '-c:v',
    'h264_videotoolbox',
    '-b:v',
    `${bitrateKbps}k`,
    '-profile:v',
    'high',
  ],
};

/**
 * Software fallback that works everywhere. Quality-targeted, so the bitrate is not used.
 * B-frames are off: with them the first frame's timestamp is delayed and only an MP4 edit
 * list pulls it back to zero, so players that ignore edit lists would show the picture
 * late against the sound. Without them the video starts at zero like the hardware output.
 */
export const SOFTWARE_H264: VideoEncoder = {
  name: 'libx264',
  outputArgs: () => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-bf', '0'],
};

const PIXELS_720P = 1280 * 720;
const PIXELS_1080P = 1920 * 1080;
const KBPS_720P = 6000;
const KBPS_1080P = 12_000;
const MIN_KBPS = 1500;
const MAX_KBPS = 40_000;

/** About 6 Mbit/s at 720p and 12 Mbit/s at 1080p, scaled linearly with the pixel count. */
export function videoBitrateKbps(width: number, height: number): number {
  const kbpsPerPixel = (KBPS_1080P - KBPS_720P) / (PIXELS_1080P - PIXELS_720P);
  const kbps = KBPS_720P + (width * height - PIXELS_720P) * kbpsPerPixel;
  return Math.round(Math.min(MAX_KBPS, Math.max(MIN_KBPS, kbps)));
}

const PROBE_TIMEOUT_MS = 15_000;
const hardwareProbes = new Map<string, Promise<boolean>>();

/**
 * Whether this FFmpeg binary can really encode with the hardware encoder on this machine.
 * Being compiled in is not enough (virtual machines and some older Macs have no hardware
 * encoder), so a few frames are actually encoded. The answer is cached per binary.
 */
export function isHardwareEncoderUsable(ffmpegPath: string): Promise<boolean> {
  let probe = hardwareProbes.get(ffmpegPath);
  if (!probe) {
    probe = probeHardwareEncoder(ffmpegPath);
    hardwareProbes.set(ffmpegPath, probe);
  }
  return probe;
}

async function probeHardwareEncoder(ffmpegPath: string): Promise<boolean> {
  const outcome = await runFfmpeg({
    ffmpegPath,
    args: [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=1280x720:r=30',
      '-frames:v',
      '5',
      '-pix_fmt',
      'yuv420p',
      ...HARDWARE_H264.outputArgs(2000),
      '-f',
      'null',
      '-',
    ],
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  return outcome.status === 'completed';
}

/** Encoders to try, best first. */
export async function preferredVideoEncoders(ffmpegPath: string): Promise<VideoEncoder[]> {
  return (await isHardwareEncoderUsable(ffmpegPath))
    ? [HARDWARE_H264, SOFTWARE_H264]
    : [SOFTWARE_H264];
}
