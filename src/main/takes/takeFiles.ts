// What a take folder contains. Kept free of app imports so test tooling can share it.
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export const VOCAL_STEM_FILE = 'vocal.f32';
export const BACKING_STEM_FILE = 'backing.f32';
export const MANIFEST_FILE = 'manifest.json';

/** Containers Chromium's MediaRecorder can produce. */
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mkv'] as const;
export type VideoExtension = (typeof VIDEO_EXTENSIONS)[number];

const VIDEO_EXTENSION_BY_CONTAINER: Record<string, VideoExtension> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
};

/** "video/webm;codecs=vp9" -> "webm". Null for containers the exporter does not know. */
export function videoExtensionForMimeType(mimeType: string): VideoExtension | null {
  const container = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return VIDEO_EXTENSION_BY_CONTAINER[container] ?? null;
}

export function videoFileName(extension: VideoExtension): string {
  return `video.${extension}`;
}

/** Path of the take's video recording, or null when the folder has none. */
export async function findVideoFile(takeDir: string): Promise<string | null> {
  for (const extension of VIDEO_EXTENSIONS) {
    const candidate = join(takeDir, videoFileName(extension));
    const isFile = await stat(candidate).then(
      (stats) => stats.isFile(),
      () => false,
    );
    if (isFile) return candidate;
  }
  return null;
}

const TAKE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Take ids are random UUIDs; checking the format also keeps an id from naming another path. */
export function isTakeId(value: unknown): value is string {
  return typeof value === 'string' && TAKE_ID.test(value);
}
