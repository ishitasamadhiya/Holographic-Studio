import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TakeInit, TakeManifest } from '@shared/take';
import { BACKING_STEM_FILE, MANIFEST_FILE, VOCAL_STEM_FILE } from './takeFiles';
import { abandonTakesOf, TakeOwners } from './takeOwners';
import { TakeStore } from './takeStore';

const SAMPLE_RATE = 48000;
const AUDIO_INIT: TakeInit = { mode: 'audio', sampleRate: SAMPLE_RATE };
const VIDEO_INIT: TakeInit = {
  mode: 'video',
  sampleRate: SAMPLE_RATE,
  video: { mimeType: 'video/webm;codecs=vp9', width: 1280, height: 720, frameRate: 30 },
};
const FIRST_PAGE = 1;
const SECOND_PAGE = 2;

function silence(frames: number): Uint8Array {
  return new Uint8Array(frames * 8);
}

function audioManifest(audioFrames: number): TakeManifest {
  return {
    mode: 'audio',
    sampleRate: SAMPLE_RATE,
    audioFrames,
    vocalLatencySec: 0,
    hasBacking: true,
  };
}

describe('TakeOwners', () => {
  it('knows which takes belong to which page until they are released', () => {
    const owners = new TakeOwners();
    owners.claim('take-a', FIRST_PAGE);
    owners.claim('take-b', FIRST_PAGE);
    owners.claim('take-c', SECOND_PAGE);

    expect(owners.takesOf(FIRST_PAGE).sort()).toEqual(['take-a', 'take-b']);
    expect(owners.takesOf(SECOND_PAGE)).toEqual(['take-c']);
    expect(owners.isOwnedBy('take-a', FIRST_PAGE)).toBe(true);
    expect(owners.isOwnedBy('take-a', SECOND_PAGE)).toBe(false);
    expect(owners.isOwnedBy('unknown', FIRST_PAGE)).toBe(false);

    owners.release('take-a');
    owners.release('unknown');
    expect(owners.takesOf(FIRST_PAGE)).toEqual(['take-b']);
    expect(owners.isOwnedBy('take-a', FIRST_PAGE)).toBe(false);
  });
});

describe('abandonTakesOf', () => {
  let root: string;
  let store: TakeStore;
  let owners: TakeOwners;

  beforeEach(async () => {
    root = join(await mkdtemp(join(tmpdir(), 'holo-owners-')), 'takes');
    store = new TakeStore(root);
    owners = new TakeOwners();
  });
  afterEach(async () => {
    await Promise.all(store.unfinishedTakeIds().map((takeId) => store.discard(takeId)));
    await rm(join(root, '..'), { recursive: true, force: true });
  });

  async function beginTake(ownerId: number, init: TakeInit = AUDIO_INIT): Promise<string> {
    const result = await store.begin(init);
    if (!result.ok) throw new Error(result.error.detail);
    owners.claim(result.value.takeId, ownerId);
    return result.value.takeId;
  }

  async function beginFinishedTake(ownerId: number): Promise<string> {
    const takeId = await beginTake(ownerId);
    store.appendAudio(takeId, silence(4800), silence(4800));
    const finished = await store.finish(takeId, audioManifest(4800));
    if (!finished.ok) throw new Error(finished.error.detail);
    return takeId;
  }

  it('deletes the unfinished takes of the page that is gone, and only those', async () => {
    const recording = await beginTake(FIRST_PAGE, VIDEO_INIT);
    store.appendAudio(recording, silence(4800), silence(4800));
    store.appendVideo(recording, new Uint8Array(1000));
    const finished = await beginFinishedTake(FIRST_PAGE);
    const otherPagesRecording = await beginTake(SECOND_PAGE);

    await abandonTakesOf(FIRST_PAGE, owners, store);

    expect((await readdir(root)).sort()).toEqual([finished, otherPagesRecording].sort());
    // The finished take is complete and can still be exported.
    expect(store.finishedTakeDir(finished)).toBe(join(root, finished));
    expect((await readdir(join(root, finished))).sort()).toEqual(
      [BACKING_STEM_FILE, MANIFEST_FILE, VOCAL_STEM_FILE].sort(),
    );
    // The other page's recording carries on untouched.
    store.appendAudio(otherPagesRecording, silence(4800), silence(4800));
    expect((await store.finish(otherPagesRecording, audioManifest(4800))).ok).toBe(true);

    expect(owners.takesOf(FIRST_PAGE)).toEqual([]);
    expect(owners.takesOf(SECOND_PAGE)).toEqual([otherPagesRecording]);
  });

  it('closes the files of the takes it deletes, even with writes still queued', async () => {
    const recording = await beginTake(FIRST_PAGE);
    for (let block = 0; block < 200; block++) {
      store.appendAudio(recording, silence(4800), silence(4800));
    }

    await abandonTakesOf(FIRST_PAGE, owners, store);

    expect(await readdir(root)).toEqual([]);
    expect(store.unfinishedTakeIds()).toEqual([]);
    // The take is gone for good: it can no longer be finished.
    expect((await store.finish(recording, audioManifest(4800))).ok).toBe(false);
  });

  it('also deletes a take whose finish had failed', async () => {
    const failed = await beginTake(FIRST_PAGE);
    expect((await store.finish(failed, audioManifest(0))).ok).toBe(false);

    await abandonTakesOf(FIRST_PAGE, owners, store);
    expect(await readdir(root)).toEqual([]);
  });

  it('does nothing for a page without takes, and nothing the second time', async () => {
    const recording = await beginTake(FIRST_PAGE);
    await abandonTakesOf(SECOND_PAGE, owners, store);
    expect(await readdir(root)).toEqual([recording]);

    await abandonTakesOf(FIRST_PAGE, owners, store);
    await abandonTakesOf(FIRST_PAGE, owners, store);
    expect(await readdir(root)).toEqual([]);
  });
});
