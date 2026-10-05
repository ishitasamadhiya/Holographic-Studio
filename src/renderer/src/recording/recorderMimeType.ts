// Which container/codec the camera is recorded in, and at what bitrate.

/**
 * Recording types in order of preference. Measured in this app's Electron (MediaRecorder on
 * the camera, 1 s timeslice):
 *
 *  - Matroska + H.264 uses the platform's hardware encoder, so encoding does not compete
 *    with the audio thread for CPU, and its data arrives chunk by chunk while recording.
 *  - "video/webm;codecs=h264" is the older name for the same thing (the recorder reports
 *    video/x-matroska for it).
 *  - MP4 + H.264 is hardware encoded too, but Chromium hands the whole file over only when
 *    the recording stops, so a long take would sit in memory until then.
 *  - VP9 and VP8 are software encoders: the fallbacks for machines without H.264 encoding.
 *
 * Every container here is one the main process stores and FFmpeg reads
 * (src/main/takes/takeFiles.ts; proven end to end by tests/e2e/ipc.spec.ts).
 */
export const RECORDER_MIME_TYPES: readonly string[] = [
  'video/x-matroska;codecs=avc1',
  'video/webm;codecs=h264',
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
];

/** The best recording type this machine supports, or null when it supports none. */
export function pickRecorderMimeType(
  isTypeSupported: (mimeType: string) => boolean,
): string | null {
  return RECORDER_MIME_TYPES.find((mimeType) => isTypeSupported(mimeType)) ?? null;
}

const PIXELS_1080P = 1920 * 1080;
const PIXELS_720P = 1280 * 720;

/**
 * Bitrate for the camera recording. It is an intermediate file that the exporter encodes
 * again, so it is generous: 16 Mbit/s from 1080p up, 8 Mbit/s from 720p, 4 Mbit/s below.
 */
export function recorderBitsPerSecond(width: number, height: number): number {
  const pixels = width * height;
  if (pixels >= PIXELS_1080P) return 16_000_000;
  if (pixels >= PIXELS_720P) return 8_000_000;
  return 4_000_000;
}
