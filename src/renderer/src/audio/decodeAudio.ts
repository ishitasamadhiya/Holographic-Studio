import { fail, ok, type Result } from '@shared/errors';

/**
 * Decodes an audio file (whatever Chromium can read) and resamples it to `sampleRate`.
 *
 * An OfflineAudioContext does the decoding, so this works whether or not the live engine is
 * running and never touches the live graph. The caller's bytes are copied first, because
 * decodeAudioData detaches the buffer it is given.
 */
export async function decodeAudioFile(
  bytes: ArrayBuffer,
  sampleRate: number,
): Promise<Result<AudioBuffer>> {
  if (bytes.byteLength === 0) return fail('unsupported-audio-file', 'The file is empty');
  try {
    const decoder = new OfflineAudioContext(1, 1, sampleRate);
    const buffer = await decoder.decodeAudioData(bytes.slice(0));
    if (buffer.length === 0) return fail('unsupported-audio-file', 'The file contains no audio');
    return ok(buffer);
  } catch (error) {
    return fail('unsupported-audio-file', error);
  }
}
