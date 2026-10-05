import { describe, expect, it } from 'vitest';
import type { TakeInit, TakeManifest } from '@shared/take';
import { parseTakeInit, parseTakeManifest } from './takeManifest';

const videoInit: TakeInit = {
  mode: 'video',
  sampleRate: 48000,
  video: { mimeType: 'video/webm;codecs=vp9', width: 1920, height: 1080, frameRate: 30 },
};

const videoManifest: TakeManifest = {
  mode: 'video',
  sampleRate: 48000,
  audioFrames: 480_000,
  vocalLatencySec: 0.031,
  hasBacking: true,
  video: { startOffsetSec: -0.12, durationSec: 9.8, width: 1920, height: 1080, frameRate: 30 },
  diagnostics: {
    inputLatencySec: 0.008,
    outputLatencySec: 0.02,
    processingLatencySec: 0.003,
    cameraLatencySec: 0.05,
    pauses: 1,
  },
};

describe('parseTakeInit', () => {
  it('accepts valid audio and video takes and returns a clean copy', () => {
    expect(parseTakeInit({ mode: 'audio', sampleRate: 44100 })).toEqual({
      mode: 'audio',
      sampleRate: 44100,
    });
    const parsed = parseTakeInit({ ...videoInit, extra: 'dropped' });
    expect(parsed).toEqual(videoInit);
    expect(parsed).not.toBe(videoInit);
  });

  it('drops a video block from an audio take', () => {
    expect(parseTakeInit({ ...videoInit, mode: 'audio' })).toEqual({
      mode: 'audio',
      sampleRate: 48000,
    });
  });

  it.each([
    ['not an object', 'take'],
    ['null', null],
    ['an unknown mode', { mode: 'hologram', sampleRate: 48000 }],
    ['a fractional sample rate', { mode: 'audio', sampleRate: 44100.5 }],
    ['an absurd sample rate', { mode: 'audio', sampleRate: 1 }],
    ['a video take without video details', { mode: 'video', sampleRate: 48000 }],
    [
      'an unknown container',
      { ...videoInit, video: { ...videoInit.video, mimeType: 'video/quicktime' } },
    ],
    ['a zero width', { ...videoInit, video: { ...videoInit.video, width: 0 } }],
    ['a NaN frame rate', { ...videoInit, video: { ...videoInit.video, frameRate: Number.NaN } }],
  ])('rejects %s', (_name, value) => {
    expect(parseTakeInit(value)).toBeNull();
  });
});

describe('parseTakeManifest', () => {
  it('accepts a complete manifest and returns a clean copy', () => {
    const parsed = parseTakeManifest({ ...videoManifest, unexpected: true });
    expect(parsed).toEqual(videoManifest);
    expect(parsed).not.toHaveProperty('unexpected');
  });

  it('survives a JSON round trip (what the exporter reads from disk)', () => {
    expect(parseTakeManifest(JSON.parse(JSON.stringify(videoManifest)))).toEqual(videoManifest);
  });

  it('accepts an audio manifest and ignores a stray video block', () => {
    const parsed = parseTakeManifest({ ...videoManifest, mode: 'audio' });
    expect(parsed?.mode).toBe('audio');
    expect(parsed?.video).toBeUndefined();
  });

  it('drops malformed diagnostics instead of rejecting the take', () => {
    const parsed = parseTakeManifest({ ...videoManifest, diagnostics: { pauses: 'two' } });
    expect(parsed).not.toBeNull();
    expect(parsed?.diagnostics).toBeUndefined();
  });

  it.each([
    ['a negative frame count', { audioFrames: -1 }],
    ['a fractional frame count', { audioFrames: 10.5 }],
    ['a NaN latency', { vocalLatencySec: Number.NaN }],
    ['an absurd latency', { vocalLatencySec: 60 }],
    ['a missing hasBacking flag', { hasBacking: undefined }],
    ['a video take without video timing', { video: undefined }],
    ['a zero video duration', { video: { ...videoManifest.video, durationSec: 0 } }],
    [
      'an infinite start offset',
      { video: { ...videoManifest.video, startOffsetSec: Number.POSITIVE_INFINITY } },
    ],
    ['an unknown mode', { mode: 'both' }],
    ['a string sample rate', { sampleRate: '48000' }],
  ])('rejects %s', (_name, override) => {
    expect(parseTakeManifest({ ...videoManifest, ...override })).toBeNull();
  });

  it.each([undefined, null, 7, 'manifest', []])('rejects %j', (value) => {
    expect(parseTakeManifest(value)).toBeNull();
  });
});
