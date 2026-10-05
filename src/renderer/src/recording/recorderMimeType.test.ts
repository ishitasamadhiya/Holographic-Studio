import { describe, expect, it } from 'vitest';
import {
  pickRecorderMimeType,
  RECORDER_MIME_TYPES,
  recorderBitsPerSecond,
} from './recorderMimeType';

describe('recording type and bitrate', () => {
  it('prefers hardware H.264 and falls back to VP9, then VP8', () => {
    expect(pickRecorderMimeType(() => true)).toBe('video/x-matroska;codecs=avc1');
    expect(pickRecorderMimeType((type) => type.includes('vp'))).toBe('video/webm;codecs=vp9');
    expect(pickRecorderMimeType((type) => type.endsWith('vp8'))).toBe('video/webm;codecs=vp8');
    expect(pickRecorderMimeType(() => false)).toBeNull();
    expect(RECORDER_MIME_TYPES.indexOf('video/webm;codecs=h264')).toBeLessThan(
      RECORDER_MIME_TYPES.indexOf('video/webm;codecs=vp9'),
    );
  });

  it('uses about 16 Mbit/s at 1080p and 8 Mbit/s at 720p', () => {
    expect(recorderBitsPerSecond(1920, 1080)).toBe(16_000_000);
    expect(recorderBitsPerSecond(1280, 720)).toBe(8_000_000);
    expect(recorderBitsPerSecond(640, 480)).toBe(4_000_000);
  });
});
