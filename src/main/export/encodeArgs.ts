import type { VideoEncoder } from './videoEncoders';

const OUTPUT_FRAME_RATE = 30;
/** Audio-only exports show one still picture, so a low frame rate loses nothing. */
const STILL_FRAME_RATE = 10;
const STILL_WIDTH = 1920;
const STILL_HEIGHT = 1080;
/** The app's background colour; also fills the bars around artwork of another shape. */
const STILL_BACKGROUND = '0x08080b';

const COMMON_INPUT_ARGS = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'];
/** Machine-readable progress on stdout, four times a second. */
const PROGRESS_ARGS = ['-progress', 'pipe:1', '-nostats', '-stats_period', '0.25'];
const AUDIO_ARGS = ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2'];
/** faststart moves the index to the front of the file so playback can begin while it loads. */
const CONTAINER_ARGS = ['-movflags', '+faststart', '-f', 'mp4'];

function seconds(value: number): string {
  return value.toFixed(6);
}

export interface VideoExportArgs {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  durationSec: number;
  encoder: VideoEncoder;
  bitrateKbps: number;
}

/**
 * Camera recording + finished mix -> MP4.
 *
 * The video filter chain, in order:
 *   setpts   the first frame becomes time zero (recordings can start at any timestamp);
 *   fps      MediaRecorder timestamps are irregular, so frames are repeated or dropped
 *            to reach an exact, constant 30 fps without changing when anything is seen;
 *   tpad     holds the last frame, because the final frame of a recording has no duration
 *            of its own and the picture would otherwise end a moment before the audio;
 *   scale    H.264 4:2:0 needs even dimensions;
 *   format   8-bit 4:2:0, the pixel format every player supports.
 * `-t` then cuts audio and video at exactly the take's duration.
 */
export function buildVideoExportArgs(options: VideoExportArgs): string[] {
  const { videoPath, audioPath, outputPath, durationSec, encoder, bitrateKbps } = options;
  const filters = [
    'setpts=PTS-STARTPTS',
    `fps=${OUTPUT_FRAME_RATE}`,
    `tpad=stop_mode=clone:stop_duration=${seconds(durationSec)}`,
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    'format=yuv420p',
  ];
  return [
    ...COMMON_INPUT_ARGS,
    ...PROGRESS_ARGS,
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-vf',
    filters.join(','),
    ...encoder.outputArgs(bitrateKbps),
    '-g',
    String(OUTPUT_FRAME_RATE * 2),
    ...AUDIO_ARGS,
    '-t',
    seconds(durationSec),
    ...CONTAINER_ARGS,
    outputPath,
  ];
}

export interface StillExportArgs {
  /** PNG to show for the whole video; null for the built-in dark frame. */
  artworkPath: string | null;
  audioPath: string;
  outputPath: string;
  durationSec: number;
}

/**
 * Finished mix + one still picture -> MP4.
 *
 * The picture is fitted into 1920x1080 (keeping its shape, padded with the app background)
 * and converted once; the `loop` filter then repeats that single prepared frame, which is
 * far cheaper than decoding and scaling the image again for every output frame.
 */
export function buildStillExportArgs(options: StillExportArgs): string[] {
  const { artworkPath, audioPath, outputPath, durationSec } = options;
  const pictureInput = artworkPath
    ? ['-i', artworkPath]
    : [
        '-f',
        'lavfi',
        '-i',
        `color=c=${STILL_BACKGROUND}:s=${STILL_WIDTH}x${STILL_HEIGHT}:r=${STILL_FRAME_RATE}:d=${1 / STILL_FRAME_RATE}`,
      ];
  const filters = [
    `scale=${STILL_WIDTH}:${STILL_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${STILL_WIDTH}:${STILL_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=${STILL_BACKGROUND}`,
    'setsar=1',
    'format=yuv420p',
    'loop=loop=-1:size=1:start=0',
    `setpts=N/(${STILL_FRAME_RATE}*TB)`,
  ];
  return [
    ...COMMON_INPUT_ARGS,
    ...PROGRESS_ARGS,
    ...pictureInput,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-vf',
    filters.join(','),
    '-r',
    String(STILL_FRAME_RATE),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'stillimage',
    '-crf',
    '18',
    '-g',
    String(STILL_FRAME_RATE * 2),
    ...AUDIO_ARGS,
    '-t',
    seconds(durationSec),
    ...CONTAINER_ARGS,
    outputPath,
  ];
}
