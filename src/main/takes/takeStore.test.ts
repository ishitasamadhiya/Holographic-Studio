import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TakeInit, TakeManifest } from '@shared/take';
import { BACKING_STEM_FILE, MANIFEST_FILE, VOCAL_STEM_FILE } from './takeFiles';
import { STALE_TAKE_AGE_MS, TakeStore } from './takeStore';

const SAMPLE_RATE = 48000;
const AUDIO_INIT: TakeInit = { mode: 'audio', sampleRate: SAMPLE_RATE };
const VIDEO_INIT: TakeInit = {
  mode: 'video',
  sampleRate: SAMPLE_RATE,
  video: { mimeType: 'video/webm;codecs=vp9', width: 1280, height: 720, frameRate: 30 },
};

let root: string;
let store: TakeStore;
let begunTakeIds: string[];

beforeEach(async () => {
  root = join(await mkdtemp(join(tmpdir(), 'holo-takes-')), 'takes');
  store = new TakeStore(root);
  begunTakeIds = [];
});
afterEach(async () => {
  // Discarding closes the files of takes a test left open.
  await Promise.all(begunTakeIds.map((takeId) => store.discard(takeId)));
  await rm(join(root, '..'), { recursive: true, force: true });
});

/** `frames` stereo float frames whose samples count up from `firstValue`. */
function audioChunk(frames: number, firstValue: number): Uint8Array {
  const samples = Float32Array.from({ length: frames * 2 }, (_, index) => firstValue + index);
  return new Uint8Array(samples.buffer);
}

function audioManifest(audioFrames: number, vocalLatencySec = 0): TakeManifest {
  return { mode: 'audio', sampleRate: SAMPLE_RATE, audioFrames, vocalLatencySec, hasBacking: true };
}

function videoManifest(audioFrames: number, durationSec: number): TakeManifest {
  return {
    ...audioManifest(audioFrames),
    mode: 'video',
    video: { startOffsetSec: 0, durationSec, width: 1280, height: 720, frameRate: 30 },
  };
}

async function beginTake(init: TakeInit = AUDIO_INIT): Promise<string> {
  const result = await store.begin(init);
  if (!result.ok) throw new Error(result.error.detail);
  begunTakeIds.push(result.value.takeId);
  return result.value.takeId;
}

async function readFloats(path: string): Promise<number[]> {
  const bytes = await readFile(path);
  return [...new Float32Array(new Uint8Array(bytes).buffer)];
}

describe('TakeStore', () => {
  it('begin creates a folder with a fresh random id for every take', async () => {
    const first = await beginTake();
    const second = await beginTake();
    expect(first).not.toBe(second);
    expect((await readdir(root)).sort()).toEqual([first, second].sort());
    expect((await readdir(join(root, first))).sort()).toEqual([BACKING_STEM_FILE, VOCAL_STEM_FILE]);
  });

  it('names the video file after the container MediaRecorder reported', async () => {
    const webm = await beginTake(VIDEO_INIT);
    const mp4 = await beginTake({
      ...VIDEO_INIT,
      video: { ...VIDEO_INIT.video!, mimeType: 'video/mp4;codecs=avc1' },
    });
    expect(await readdir(join(root, webm))).toContain('video.webm');
    expect(await readdir(join(root, mp4))).toContain('video.mp4');
  });

  it('rejects an invalid take description without creating anything', async () => {
    const result = await store.begin({ mode: 'video', sampleRate: SAMPLE_RATE });
    expect(result).toMatchObject({ ok: false, error: { code: 'recording-failed' } });
    await expect(readdir(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stores a complete take: stems in order, video bytes, manifest, summary', async () => {
    const takeId = await beginTake(VIDEO_INIT);
    const videoParts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])];
    for (let block = 0; block < 50; block++) {
      store.appendAudio(
        takeId,
        audioChunk(960, block * 10_000),
        audioChunk(960, -1 - block * 10_000),
      );
      if (block % 20 === 0) store.appendVideo(takeId, videoParts[block / 20]!);
    }

    const manifest = videoManifest(48_000, 0.9);
    const result = await store.finish(takeId, manifest);

    expect(result).toEqual({
      ok: true,
      value: { takeId, durationSec: 0.9, audioBytes: 2 * 48_000 * 8, videoBytes: 6 },
    });
    const dir = join(root, takeId);
    const vocal = await readFloats(join(dir, VOCAL_STEM_FILE));
    const backing = await readFloats(join(dir, BACKING_STEM_FILE));
    expect(vocal.length).toBe(96_000);
    for (const block of [0, 1, 17, 49]) {
      expect(vocal[block * 1920]).toBe(block * 10_000);
      expect(vocal[block * 1920 + 1919]).toBe(block * 10_000 + 1919);
      expect(backing[block * 1920]).toBe(-1 - block * 10_000);
    }
    expect([...(await readFile(join(dir, 'video.webm')))]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8'))).toEqual(manifest);
    expect(store.finishedTakeDir(takeId)).toBe(dir);
  });

  it('reports the audio-only duration with the latency trim applied', async () => {
    const takeId = await beginTake();
    store.appendAudio(takeId, audioChunk(48_000, 0), audioChunk(48_000, 0));
    const result = await store.finish(takeId, audioManifest(48_000, 0.05));
    expect(result).toMatchObject({ ok: true, value: { durationSec: 0.95, videoBytes: 0 } });
  });

  it.each([
    ['fewer frames than the manifest claims', 47_520, 47_520],
    ['more frames than the manifest claims', 48_480, 48_000],
  ])(
    'repairs a small frame-count mismatch (%s) by trusting the smaller number',
    async (_name, framesSent, expectedFrames) => {
      const takeId = await beginTake();
      store.appendAudio(takeId, audioChunk(framesSent, 0), audioChunk(framesSent, 0));
      const result = await store.finish(takeId, audioManifest(48_000));

      expect(result).toMatchObject({ ok: true, value: { durationSec: expectedFrames / 48_000 } });
      const stored = JSON.parse(
        await readFile(join(root, takeId, MANIFEST_FILE), 'utf8'),
      ) as TakeManifest;
      expect(stored.audioFrames).toBe(expectedFrames);
    },
  );

  it('fails a take whose audio went missing (large frame-count mismatch)', async () => {
    const takeId = await beginTake();
    store.appendAudio(takeId, audioChunk(48_000, 0), audioChunk(48_000, 0));
    const result = await store.finish(takeId, audioManifest(48_000 * 3));
    expect(result).toMatchObject({ ok: false, error: { code: 'recording-failed' } });
    expect(store.finishedTakeDir(takeId)).toBeNull();
  });

  it('fails when the stems were sent out of lockstep', async () => {
    const takeId = await beginTake();
    store.appendAudio(takeId, audioChunk(100, 0), audioChunk(100, 0));
    store.appendAudio(takeId, audioChunk(100, 0), audioChunk(99, 0));
    const result = await store.finish(takeId, audioManifest(200));
    expect(result).toMatchObject({ ok: false, error: { code: 'recording-failed' } });
    if (!result.ok) expect(result.error.detail).toMatch(/differ in length/);
  });

  it('fails a take that was marked broken (a chunk never arrived intact)', async () => {
    const takeId = await beginTake();
    store.appendAudio(takeId, audioChunk(4800, 0), audioChunk(4800, 0));
    store.markBroken(takeId, 'An audio chunk arrived in an unreadable form');
    store.markBroken('unknown-take', 'ignored');
    const result = await store.finish(takeId, audioManifest(4800));
    expect(result).toMatchObject({ ok: false, error: { code: 'recording-failed' } });
    if (!result.ok) expect(result.error.detail).toMatch(/unreadable form/);
  });

  it('fails an empty take and a video take without video', async () => {
    const empty = await beginTake();
    expect(await store.finish(empty, audioManifest(0))).toMatchObject({
      ok: false,
      error: { code: 'recording-failed' },
    });

    const noVideo = await beginTake(VIDEO_INIT);
    store.appendAudio(noVideo, audioChunk(4800, 0), audioChunk(4800, 0));
    expect(await store.finish(noVideo, videoManifest(4800, 0.1))).toMatchObject({
      ok: false,
      error: { code: 'recording-failed' },
    });
  });

  it.each([
    ['shorter than the vocal latency trim', 4800, audioManifest(4800, 0.2)],
    ['a manifest that reports no frames', 24_000, audioManifest(0)],
  ])(
    'fails a take with nothing left to export (%s) and stores no manifest',
    async (_name, framesSent, manifest) => {
      const takeId = await beginTake();
      store.appendAudio(takeId, audioChunk(framesSent, 0), audioChunk(framesSent, 0));
      const result = await store.finish(takeId, manifest);

      expect(result).toMatchObject({ ok: false, error: { code: 'recording-failed' } });
      if (!result.ok) expect(result.error.detail).toMatch(/too short/);
      expect(store.finishedTakeDir(takeId)).toBeNull();
      expect(await readdir(join(root, takeId))).not.toContain(MANIFEST_FILE);
    },
  );

  it('fails when the manifest is invalid or contradicts how the take was started', async () => {
    const takeId = await beginTake();
    store.appendAudio(takeId, audioChunk(4800, 0), audioChunk(4800, 0));

    const invalid = { ...audioManifest(4800), vocalLatencySec: Number.NaN };
    expect((await store.finish(takeId, invalid)).ok).toBe(false);
    expect((await store.finish(takeId, videoManifest(4800, 0.1))).ok).toBe(false);
    expect((await store.finish(takeId, { ...audioManifest(4800), sampleRate: 44100 })).ok).toBe(
      false,
    );
    // A correct manifest still works afterwards.
    expect((await store.finish(takeId, audioManifest(4800))).ok).toBe(true);
  });

  it('finish is idempotent and later chunks do not change a finished take', async () => {
    const takeId = await beginTake();
    store.appendAudio(takeId, audioChunk(4800, 0), audioChunk(4800, 0));
    const first = await store.finish(takeId, audioManifest(4800));
    store.appendAudio(takeId, audioChunk(4800, 0), audioChunk(4800, 0));
    const second = await store.finish(takeId, audioManifest(9600));

    expect(second).toEqual(first);
    expect((await stat(join(root, takeId, VOCAL_STEM_FILE))).size).toBe(4800 * 8);
  });

  it('handles unknown take ids gracefully everywhere', async () => {
    const unknown = randomUUID();
    store.appendAudio(unknown, audioChunk(10, 0), audioChunk(10, 0));
    store.appendVideo(unknown, new Uint8Array([1]));
    expect(await store.finish(unknown, audioManifest(10))).toMatchObject({
      ok: false,
      error: { code: 'recording-failed' },
    });
    expect(store.finishedTakeDir(unknown)).toBeNull();
    await expect(store.discard(unknown)).resolves.toBeUndefined();
    await expect(store.discard('../not-an-id')).resolves.toBeUndefined();
  });

  it('discard removes the folder of a recording or finished take', async () => {
    const recording = await beginTake(VIDEO_INIT);
    store.appendAudio(recording, audioChunk(4800, 0), audioChunk(4800, 0));
    store.appendVideo(recording, new Uint8Array(1000));
    const finished = await beginTake();
    store.appendAudio(finished, audioChunk(4800, 0), audioChunk(4800, 0));
    await store.finish(finished, audioManifest(4800));

    await store.discard(recording);
    await store.discard(finished);
    await store.discard(finished);

    expect(await readdir(root)).toEqual([]);
    expect(store.finishedTakeDir(finished)).toBeNull();
    expect((await store.finish(recording, audioManifest(4800))).ok).toBe(false);
  });

  it('lists the takes that were begun but not successfully finished', async () => {
    const recording = await beginTake(VIDEO_INIT);
    const failed = await beginTake();
    const finished = await beginTake();
    const discarded = await beginTake();
    store.appendAudio(finished, audioChunk(4800, 0), audioChunk(4800, 0));
    expect((await store.finish(finished, audioManifest(4800))).ok).toBe(true);
    // Nothing was recorded, so finishing fails and the take stays unfinished.
    expect((await store.finish(failed, audioManifest(0))).ok).toBe(false);
    await store.discard(discarded);

    expect(store.unfinishedTakeIds().sort()).toEqual([recording, failed].sort());
  });

  it('discard never deletes outside the takes folder', async () => {
    const outside = join(root, '..', 'precious');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'file.txt'), 'keep me');
    await store.discard('../precious');
    await store.discard('..');
    expect(await readFile(join(outside, 'file.txt'), 'utf8')).toBe('keep me');
  });

  describe('removeStaleTakes', () => {
    async function leftoverTake(ageMs: number): Promise<string> {
      const dir = join(root, randomUUID());
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, VOCAL_STEM_FILE), 'old audio');
      const when = new Date(Date.now() - ageMs);
      await utimes(join(dir, VOCAL_STEM_FILE), when, when);
      await utimes(dir, when, when);
      return dir;
    }

    it('removes leftovers older than 24 hours and keeps recent ones', async () => {
      const old = await leftoverTake(STALE_TAKE_AGE_MS + 60_000);
      const recent = await leftoverTake(STALE_TAKE_AGE_MS - 60_000);

      expect(await store.removeStaleTakes()).toBe(1);
      await expect(stat(old)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await stat(recent)).isDirectory()).toBe(true);
    });

    it('goes by the most recently touched file, not the folder date alone', async () => {
      const dir = await leftoverTake(STALE_TAKE_AGE_MS * 2);
      await writeFile(join(dir, BACKING_STEM_FILE), 'fresh audio');
      const longAgo = new Date(Date.now() - STALE_TAKE_AGE_MS * 2);
      await utimes(dir, longAgo, longAgo);

      expect(await store.removeStaleTakes()).toBe(0);
      expect((await stat(dir)).isDirectory()).toBe(true);
    });

    it('never touches the takes of this session or anything that is not a take folder', async () => {
      const active = await beginTake();
      const longAgo = new Date(Date.now() - STALE_TAKE_AGE_MS * 3);
      await utimes(join(root, active, VOCAL_STEM_FILE), longAgo, longAgo);
      await utimes(join(root, active, BACKING_STEM_FILE), longAgo, longAgo);
      await utimes(join(root, active), longAgo, longAgo);
      await mkdir(join(root, 'not-a-take'));
      await utimes(join(root, 'not-a-take'), longAgo, longAgo);

      expect(await store.removeStaleTakes()).toBe(0);
      expect((await readdir(root)).sort()).toEqual([active, 'not-a-take'].sort());
    });

    it('does nothing when the takes folder does not exist yet', async () => {
      expect(await new TakeStore(join(root, 'missing')).removeStaleTakes()).toBe(0);
    });
  });
});
