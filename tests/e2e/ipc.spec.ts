// Proves the whole window.holo bridge in the real app: every call below goes from the
// sandboxed page through the preload script and IPC into the main-process services.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { launchApp, type LaunchedApp } from './helpers/app';
import {
  frameBrightness,
  probeMedia,
  topLevelMp4Boxes,
  videoFrameTimes,
} from './helpers/takeFixtures';

/** Makes the native save dialog "return" the given path (null = the user cancelled). */
async function stubSaveDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, chosenPath) => {
    const stub = async () => ({ canceled: chosenPath === null, filePath: chosenPath ?? '' });
    dialog.showSaveDialog = stub as typeof dialog.showSaveDialog;
  }, filePath);
}

/** Makes the native open dialog "return" the given path (null = the user cancelled). */
async function stubOpenDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, chosenPath) => {
    const stub = async () => ({
      canceled: chosenPath === null,
      filePaths: chosenPath === null ? [] : [chosenPath],
    });
    dialog.showOpenDialog = stub as typeof dialog.showOpenDialog;
  }, filePath);
}

/** The recording types the app may ask MediaRecorder for, best first. */
const VIDEO_MIME_TYPES = [
  'video/mp4;codecs=avc1',
  'video/webm;codecs=h264',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
] as const;

/** Streams an audio-only take (a steady tone of whole seconds) from the page and finishes it. */
async function recordAudioTake(page: Page, seconds: number): Promise<string> {
  return page.evaluate(async (durationSec) => {
    const sampleRate = 48000;
    const begun = await window.holo.take.begin({ mode: 'audio', sampleRate });
    if (!begun.ok) throw new Error(`begin failed: ${begun.error.detail}`);
    const { takeId } = begun.value;

    // One second of these tones repeats exactly, so the same block can be sent every time.
    const vocal = new Float32Array(sampleRate * 2);
    const backing = new Float32Array(sampleRate * 2);
    for (let frame = 0; frame < sampleRate; frame++) {
      const time = frame / sampleRate;
      vocal[frame * 2] = vocal[frame * 2 + 1] = 0.2 * Math.sin(2 * Math.PI * 440 * time);
      backing[frame * 2] = backing[frame * 2 + 1] = 0.1 * Math.sin(2 * Math.PI * 220 * time);
    }
    for (let second = 0; second < durationSec; second++) {
      window.holo.take.appendAudio(takeId, { vocal: vocal.buffer, backing: backing.buffer });
    }

    const finished = await window.holo.take.finish(takeId, {
      mode: 'audio',
      sampleRate,
      audioFrames: sampleRate * durationSec,
      vocalLatencySec: 0,
      hasBacking: true,
    });
    if (!finished.ok) throw new Error(`finish failed: ${finished.error.detail}`);
    return takeId;
  }, seconds);
}

/** lsof ships with macOS; elsewhere the open-file checks are skipped. */
const CAN_LIST_OPEN_FILES = process.platform === 'darwin';

/** How many files whose path contains `text` the process has open. */
function openFilesMentioning(processId: number, text: string): number {
  const result = spawnSync('lsof', ['-p', String(processId), '-Fn'], { encoding: 'utf8' });
  return result.stdout.split('\n').filter((line) => line.includes(text)).length;
}

/** Ids of the running processes whose command line contains `text` (macOS and Linux). */
function processesMentioning(text: string): string[] {
  const result = spawnSync('pgrep', ['-f', text], { encoding: 'utf8' });
  return result.stdout.split('\n').filter((line) => line.trim().length > 0);
}

test.describe('window.holo in the running app', () => {
  let launched: LaunchedApp;
  let workDir: string;

  test.beforeAll(async () => {
    launched = await launchApp();
    workDir = mkdtempSync(join(tmpdir(), 'holo-e2e-ipc-'));
  });

  test.afterAll(async () => {
    await launched.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  test('app info and permissions reflect the end-to-end environment', async () => {
    const { page } = launched;
    const info = await page.evaluate(() => window.holo.app.getInfo());
    expect(info).toEqual({ version: '0.1.0', platform: process.platform, isE2E: true });

    const permissions = await page.evaluate(async () => ({
      microphone: await window.holo.permissions.getStatus('microphone'),
      camera: await window.holo.permissions.request('camera'),
    }));
    expect(permissions).toEqual({ microphone: 'granted', camera: 'granted' });

    // The old placeholder bridge is gone.
    expect(await page.evaluate(() => 'holoBootstrap' in window)).toBe(false);
  });

  test('the analysis cache round-trips through IPC and ignores bad keys', async () => {
    const key = createHash('sha256').update('e2e reference song').digest('hex');
    const outcome = await launched.page.evaluate(async (cacheKey) => {
      const analysis = {
        schemaVersion: 1 as const,
        durationSec: 12.5,
        contour: { hopSec: 0.01, f0Hz: [0, 220, 440], confidence: [0, 0.9, 0.8] },
        notes: [{ startSec: 0.01, endSec: 0.03, midi: 57, confidence: 0.9 }],
        key: { tonic: 9, mode: 'minor' as const, confidence: 0.6 },
        tuningCents: 3,
        quality: 'fair' as const,
        stats: { voicedRatio: 0.66, meanConfidence: 0.85, noteCount: 1 },
      };
      const before = await window.holo.analysisCache.get(cacheKey);
      await window.holo.analysisCache.put(cacheKey, analysis);
      const after = await window.holo.analysisCache.get(cacheKey);
      await window.holo.analysisCache.put('../escape', analysis);
      const badKey = await window.holo.analysisCache.get('../escape');
      return { before, after, analysis, badKey };
    }, key);

    expect(outcome.before).toBeNull();
    expect(outcome.after).toEqual(outcome.analysis);
    expect(outcome.badKey).toBeNull();
    expect(readdirSync(join(launched.userDataDir, 'analysis-cache'))).toEqual([`${key}.v1.json`]);
  });

  test('an audio file is picked through the native dialog and read with its hash', async () => {
    const { app, page } = launched;
    const songPath = join(workDir, 'Backing Track.wav');
    const songBytes = randomBytes(150_000);
    writeFileSync(songPath, songBytes);

    await stubOpenDialog(app, null);
    expect(await page.evaluate(() => window.holo.files.pickAudioFile('backing'))).toBeNull();

    await stubOpenDialog(app, songPath);
    const picked = await page.evaluate(() => window.holo.files.pickAudioFile('reference'));
    expect(picked).toEqual({ path: songPath, name: 'Backing Track.wav', sizeBytes: 150_000 });

    const loaded = await page.evaluate(async (path) => {
      const result = await window.holo.files.readAudioFile(path);
      if (!result.ok) return { ok: false as const, code: result.error.code };
      const { bytes, ...details } = result.value;
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const digestHex = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      return {
        ok: true as const,
        details,
        isArrayBuffer: bytes instanceof ArrayBuffer,
        byteLength: bytes.byteLength,
        digestHex,
      };
    }, songPath);

    const expectedHash = createHash('sha256').update(songBytes).digest('hex');
    expect(loaded).toEqual({
      ok: true,
      details: {
        path: songPath,
        name: 'Backing Track.wav',
        sizeBytes: 150_000,
        sha256: expectedHash,
      },
      isArrayBuffer: true,
      byteLength: 150_000,
      // The bytes that arrived in the page hash to the same value main computed.
      digestHex: expectedHash,
    });

    const failures = await page.evaluate(async (dir) => {
      const missing = await window.holo.files.readAudioFile(`${dir}/missing.mp3`);
      const wrongType = await window.holo.files.readAudioFile(`${dir}/notes.txt`);
      return {
        missing: missing.ok ? null : missing.error.code,
        wrongType: wrongType.ok ? null : wrongType.error.code,
        constructedFilePath: window.holo.files.pathForDroppedFile(new File(['x'], 'x.wav')),
      };
    }, workDir);
    expect(failures).toEqual({
      missing: 'file-read-failed',
      wrongType: 'unsupported-audio-file',
      // Only files that really came from disk (a drop or a picker) have a path.
      constructedFilePath: '',
    });
  });

  test('an audio-only take streamed from the page is exported as an MP4', async () => {
    const { app, page, userDataDir } = launched;
    const saveDir = join(workDir, 'audio-export');
    const savePath = join(saveDir, 'E2E Audio Take.mp4');
    mkdirSync(saveDir);

    await stubSaveDialog(app, null);
    expect(await page.evaluate(() => window.holo.exporter.chooseSavePath('x.mp4'))).toBeNull();
    // The dialog "returns" a name without extension; the app must add it.
    await stubSaveDialog(app, join(saveDir, 'E2E Audio Take'));

    const outcome = await page.evaluate(async () => {
      const sampleRate = 48000;
      const seconds = 4;
      const vocalLatencySec = 0.05;
      const blockFrames = 4800;
      const totalFrames = sampleRate * seconds;

      const begun = await window.holo.take.begin({ mode: 'audio', sampleRate });
      if (!begun.ok) throw new Error(`begin failed: ${begun.error.detail}`);
      const { takeId } = begun.value;

      for (let start = 0; start < totalFrames; start += blockFrames) {
        const vocal = new Float32Array(blockFrames * 2);
        const backing = new Float32Array(blockFrames * 2);
        for (let frame = 0; frame < blockFrames; frame++) {
          const time = (start + frame) / sampleRate;
          vocal[frame * 2] = vocal[frame * 2 + 1] = 0.2 * Math.sin(2 * Math.PI * 440 * time);
          backing[frame * 2] = backing[frame * 2 + 1] = 0.1 * Math.sin(2 * Math.PI * 220 * time);
        }
        window.holo.take.appendAudio(takeId, { vocal: vocal.buffer, backing: backing.buffer });
      }
      const finished = await window.holo.take.finish(takeId, {
        mode: 'audio',
        sampleRate,
        audioFrames: totalFrames,
        vocalLatencySec,
        hasBacking: true,
      });

      // White artwork drawn in the page, to prove binary data survives the trip to FFmpeg.
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const artworkBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no PNG'))), 'image/png'),
      );
      const artworkPng = await artworkBlob.arrayBuffer();

      const heard: Array<{ takeId: string; stage: string; fraction: number }> = [];
      let unsubscribedListenerCalls = 0;
      const unsubscribeEarly = window.holo.exporter.onProgress(() => {
        unsubscribedListenerCalls += 1;
      });
      unsubscribeEarly();
      const unsubscribe = window.holo.exporter.onProgress((progress) => heard.push(progress));

      const outputPath = await window.holo.exporter.chooseSavePath('E2E Audio Take.mp4');
      if (!outputPath) throw new Error('save dialog was cancelled');
      const exported = await window.holo.exporter.start({ takeId, outputPath, artworkPng });
      unsubscribe();

      const settings = await window.holo.settings.load();
      return {
        takeId,
        finished,
        outputPath,
        exported,
        heard,
        unsubscribedListenerCalls,
        lastSaveDir: settings.lastSaveDir,
      };
    });

    expect(outcome.finished).toMatchObject({
      ok: true,
      value: { takeId: outcome.takeId, audioBytes: 2 * 4 * 48000 * 8, videoBytes: 0 },
    });
    expect(outcome.outputPath).toBe(savePath);
    expect(outcome.lastSaveDir).toBe(saveDir);
    expect(outcome.exported).toEqual({
      ok: true,
      value: { outputPath: savePath, durationSec: 3.95, sizeBytes: statSync(savePath).size },
    });

    // Progress events reached the subscribed listener only, in order, for this take.
    expect(outcome.unsubscribedListenerCalls).toBe(0);
    expect(outcome.heard.length).toBeGreaterThan(2);
    expect(outcome.heard.every((progress) => progress.takeId === outcome.takeId)).toBe(true);
    expect(outcome.heard[0]!.stage).toBe('mixing');
    expect(outcome.heard.at(-1)).toMatchObject({ stage: 'finishing', fraction: 1 });
    for (let index = 1; index < outcome.heard.length; index++) {
      expect(outcome.heard[index]!.fraction).toBeGreaterThanOrEqual(
        outcome.heard[index - 1]!.fraction,
      );
    }

    const media = await probeMedia(savePath);
    expect(media.video.map((stream) => stream.codecName)).toEqual(['h264']);
    expect(media.audio.map((stream) => stream.codecName)).toEqual(['aac']);
    expect(media.video[0]).toMatchObject({ pixelFormat: 'yuv420p', width: 1920, height: 1080 });
    expect(media.audio[0]).toMatchObject({ sampleRate: 48000, channels: 2 });
    expect(Math.abs(media.audio[0]!.durationSec - 3.95)).toBeLessThan(0.05);
    expect(Math.abs(media.durationSec - 3.95)).toBeLessThan(0.11);
    const boxes = await topLevelMp4Boxes(savePath);
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));
    // The artwork drawn in the page is what the video shows.
    expect((await frameBrightness(savePath))[0]).toBeGreaterThan(200);
    expect(readdirSync(saveDir)).toEqual(['E2E Audio Take.mp4']);

    // The take stays on disk until the UI discards it.
    const takeDir = join(userDataDir, 'takes', outcome.takeId);
    expect(existsSync(join(takeDir, 'manifest.json'))).toBe(true);
    await page.evaluate((takeId) => window.holo.take.discard(takeId), outcome.takeId);
    expect(existsSync(takeDir)).toBe(false);

    const afterDiscard = await page.evaluate(
      async ({ takeId, outputPath }) => {
        await window.holo.take.discard(takeId);
        await window.holo.exporter.cancel(takeId);
        return window.holo.exporter.start({ takeId, outputPath });
      },
      { takeId: outcome.takeId, outputPath: savePath },
    );
    expect(afterDiscard).toMatchObject({ ok: false, error: { code: 'export-failed' } });
  });

  test('MediaRecorder supports at least one of the recording types the app can use', async () => {
    const support = await launched.page.evaluate(
      (types) => types.map((type) => ({ type, supported: MediaRecorder.isTypeSupported(type) })),
      [...VIDEO_MIME_TYPES],
    );
    console.log('MediaRecorder.isTypeSupported in this Electron:');
    for (const { type, supported } of support) console.log(`  ${type} -> ${supported}`);
    expect(support.some((entry) => entry.supported)).toBe(true);
  });

  for (const [index, mimeType] of VIDEO_MIME_TYPES.entries()) {
    test(`a video take recorded as ${mimeType} is exported as an MP4 with the picture in time`, async () => {
      const { app, page, userDataDir } = launched;
      const isSupported = await page.evaluate(
        (type) => MediaRecorder.isTypeSupported(type),
        mimeType,
      );
      test.skip(!isSupported, `MediaRecorder cannot record ${mimeType} in this Electron`);

      const savePath = join(workDir, `E2E Video Take ${index}.mp4`);
      await stubSaveDialog(app, savePath);

      const outcome = await page.evaluate(
        async ({ recorderType, recordSec, flashAtSec, flashSec }) => {
          const sampleRate = 48000;
          const width = 640;
          const height = 360;
          const begun = await window.holo.take.begin({
            mode: 'video',
            sampleRate,
            video: { mimeType: recorderType, width, height, frameRate: 30 },
          });
          if (!begun.ok) throw new Error(`begin failed: ${begun.error.detail}`);
          const { takeId } = begun.value;

          // A moving, fairly dark picture on a canvas stands in for the camera. Once the
          // recording runs, the whole canvas turns white for a moment at a known time.
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d')!;
          let drawn = 0;
          let startedAt: number | null = null;
          // Set from the drawing timer; the cast stops TypeScript from assuming it stays null.
          let flashShownAtSec = null as number | null;
          const draw = (): void => {
            const sinceStartSec = startedAt === null ? -1 : (performance.now() - startedAt) / 1000;
            if (sinceStartSec >= flashAtSec && sinceStartSec < flashAtSec + flashSec) {
              context.fillStyle = 'white';
              context.fillRect(0, 0, width, height);
              flashShownAtSec ??= sinceStartSec;
            } else {
              context.fillStyle = `hsl(${(drawn * 7) % 360} 70% 30%)`;
              context.fillRect(0, 0, width, height);
              context.fillStyle = 'white';
              context.fillRect((drawn * 9) % width, 120, 60, 60);
            }
            drawn += 1;
          };
          draw();
          const drawTimer = setInterval(draw, 1000 / 30);
          const stream = canvas.captureStream(30);

          const recorder = new MediaRecorder(stream, {
            mimeType: recorderType,
            videoBitsPerSecond: 2_000_000,
          });
          let videoBytes = 0;
          let pendingChunks = Promise.resolve();
          recorder.ondataavailable = (event) => {
            // Blob -> ArrayBuffer is asynchronous; chaining keeps the chunks in order.
            pendingChunks = pendingChunks.then(async () => {
              const chunk = await event.data.arrayBuffer();
              videoBytes += chunk.byteLength;
              window.holo.take.appendVideo(takeId, chunk);
            });
          };
          const stopped = new Promise<void>((resolve) => {
            recorder.onstop = () => resolve();
          });

          // Frames are captured from the start() call on (the "start" event fires later, once
          // the encoder is ready), so that is where the recording's clock is measured from.
          startedAt = performance.now();
          recorder.start(200);
          await new Promise((resolve) => setTimeout(resolve, recordSec * 1000));
          const videoDurationSec = (performance.now() - startedAt) / 1000;
          recorder.stop();
          await stopped;
          await pendingChunks;
          clearInterval(drawTimer);
          stream.getTracks().forEach((track) => track.stop());

          // Stems a little longer than the video, as in a real take.
          const blockFrames = 4800;
          const totalFrames = Math.ceil((videoDurationSec + 0.5) * sampleRate);
          for (let start = 0; start < totalFrames; start += blockFrames) {
            const frames = Math.min(blockFrames, totalFrames - start);
            const vocal = new Float32Array(frames * 2);
            const backing = new Float32Array(frames * 2);
            for (let frame = 0; frame < frames; frame++) {
              const time = (start + frame) / sampleRate;
              vocal[frame * 2] = vocal[frame * 2 + 1] = 0.2 * Math.sin(2 * Math.PI * 330 * time);
              backing[frame * 2] = backing[frame * 2 + 1] =
                0.1 * Math.sin(2 * Math.PI * 110 * time);
            }
            window.holo.take.appendAudio(takeId, { vocal: vocal.buffer, backing: backing.buffer });
          }

          const finished = await window.holo.take.finish(takeId, {
            mode: 'video',
            sampleRate,
            audioFrames: totalFrames,
            vocalLatencySec: 0.03,
            hasBacking: true,
            video: {
              startOffsetSec: 0.1,
              durationSec: videoDurationSec,
              width,
              height,
              frameRate: 30,
            },
          });

          const outputPath = await window.holo.exporter.chooseSavePath('E2E Video Take.mp4');
          if (!outputPath) throw new Error('save dialog was cancelled');
          const exported = await window.holo.exporter.start({ takeId, outputPath });
          return {
            takeId,
            producedType: recorder.mimeType,
            videoBytes,
            videoDurationSec,
            flashShownAtSec,
            finished,
            exported,
          };
        },
        { recorderType: mimeType, recordSec: 2.5, flashAtSec: 1, flashSec: 0.2 },
      );

      expect(outcome.videoBytes).toBeGreaterThan(10_000);
      expect(outcome.finished).toMatchObject({
        ok: true,
        value: { takeId: outcome.takeId, videoBytes: outcome.videoBytes },
      });
      expect(outcome.exported).toMatchObject({ ok: true, value: { outputPath: savePath } });
      if (!outcome.exported.ok) return;
      expect(outcome.exported.value.durationSec).toBeCloseTo(outcome.videoDurationSec, 3);

      const media = await probeMedia(savePath);
      expect(media.streams.length).toBe(2);
      expect(media.video[0]).toMatchObject({
        codecName: 'h264',
        pixelFormat: 'yuv420p',
        width: 640,
        height: 360,
        frameRate: 30,
      });
      expect(media.audio[0]).toMatchObject({ codecName: 'aac', sampleRate: 48000, channels: 2 });
      const exportedVideoSec = media.video[0]!.durationSec;
      expect(Math.abs(exportedVideoSec - outcome.videoDurationSec)).toBeLessThan(0.05);
      expect(Math.abs(media.audio[0]!.durationSec - outcome.videoDurationSec)).toBeLessThan(0.05);
      const boxes = await topLevelMp4Boxes(savePath);
      expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));

      // The exported picture is as long as what MediaRecorder really captured: compare with
      // the frame timestamps inside the raw recording that main wrote to the take folder.
      const takeDir = join(userDataDir, 'takes', outcome.takeId);
      const rawVideo = readdirSync(takeDir).find((name) => name.startsWith('video.'));
      expect(rawVideo).toBeDefined();
      const rawTimes = await videoFrameTimes(join(takeDir, rawVideo!));
      const rawVideoSec = rawTimes.at(-1)! - rawTimes[0]! + 1 / 30;
      expect(rawTimes.length).toBeGreaterThan(30);
      expect(Math.abs(exportedVideoSec - rawVideoSec)).toBeLessThan(0.35);

      // The picture is in time, not just the right length: the flash that was drawn a known
      // time after recording began is seen at that same time in the exported video.
      const brightness = await frameBrightness(savePath);
      const flashFrame = brightness.findIndex((value) => value > 200);
      expect(outcome.flashShownAtSec).not.toBeNull();
      const expectedFlashFrame = outcome.flashShownAtSec! * 30;
      console.log(
        `${mimeType} -> ${outcome.producedType} (${rawVideo}): ${outcome.videoBytes} bytes, ` +
          `${rawTimes.length} frames over ${rawVideoSec.toFixed(3)} s, exported ` +
          `${exportedVideoSec.toFixed(3)} s; flash drawn at ` +
          `${outcome.flashShownAtSec!.toFixed(3)} s, seen in output frame ${flashFrame}`,
      );
      expect(flashFrame).toBeGreaterThanOrEqual(0);
      expect(Math.abs(flashFrame - expectedFlashFrame)).toBeLessThanOrEqual(2);
      // Apart from the flash the picture really moves (it is not one frozen frame).
      expect(new Set(brightness.map((value) => Math.round(value))).size).toBeGreaterThan(5);

      await page.evaluate((takeId) => window.holo.take.discard(takeId), outcome.takeId);
      expect(existsSync(takeDir)).toBe(false);
    });
  }

  test('a reload discards the recording the page left unfinished and keeps its finished take', async () => {
    const { app, page, userDataDir } = launched;
    const takesDir = join(userDataDir, 'takes');
    const mainProcessId = app.process().pid!;

    const finishedId = await recordAudioTake(page, 1);
    const unfinishedId = await page.evaluate(async () => {
      const begun = await window.holo.take.begin({
        mode: 'video',
        sampleRate: 48000,
        video: { mimeType: 'video/webm;codecs=vp9', width: 640, height: 360, frameRate: 30 },
      });
      if (!begun.ok) throw new Error(`begin failed: ${begun.error.detail}`);
      const silence = new Float32Array(4800 * 2);
      window.holo.take.appendAudio(begun.value.takeId, {
        vocal: silence.buffer,
        backing: silence.buffer,
      });
      window.holo.take.appendVideo(begun.value.takeId, new Uint8Array(1000).buffer);
      return begun.value.takeId;
    });
    await expect.poll(() => statSync(join(takesDir, unfinishedId, 'video.webm')).size).toBe(1000);
    // Main holds the recording's three files open while the take is being recorded.
    if (CAN_LIST_OPEN_FILES) expect(openFilesMentioning(mainProcessId, unfinishedId)).toBe(3);

    await page.reload();

    // The new page cannot know the take ids of the old one, so nobody could ever finish or
    // discard that recording: main has to let go of it by itself.
    await expect.poll(() => existsSync(join(takesDir, unfinishedId))).toBe(false);
    if (CAN_LIST_OPEN_FILES) {
      await expect.poll(() => openFilesMentioning(mainProcessId, unfinishedId)).toBe(0);
    }
    expect(readdirSync(join(takesDir, finishedId)).sort()).toEqual([
      'backing.f32',
      'manifest.json',
      'vocal.f32',
    ]);

    // The finished take is complete on disk and still exports.
    const savePath = join(workDir, 'after-reload.mp4');
    const afterReload = await page.evaluate(
      async ({ finishedTakeId, unfinishedTakeId, outputPath }) => {
        const lateFinish = await window.holo.take.finish(unfinishedTakeId, {
          mode: 'video',
          sampleRate: 48000,
          audioFrames: 4800,
          vocalLatencySec: 0,
          hasBacking: false,
          video: { startOffsetSec: 0, durationSec: 0.1, width: 640, height: 360, frameRate: 30 },
        });
        const exported = await window.holo.exporter.start({ takeId: finishedTakeId, outputPath });
        await window.holo.take.discard(finishedTakeId);
        return { lateFinishCode: lateFinish.ok ? null : lateFinish.error.code, exported };
      },
      { finishedTakeId: finishedId, unfinishedTakeId: unfinishedId, outputPath: savePath },
    );
    expect(afterReload.lateFinishCode).toBe('recording-failed');
    expect(afterReload.exported).toMatchObject({ ok: true, value: { durationSec: 1 } });
    expect(existsSync(join(takesDir, finishedId))).toBe(false);
  });
});

/** The two ordinary ways of leaving the app. */
const WAYS_TO_QUIT: Array<[name: string, quit: (app: ElectronApplication) => Promise<void>]> = [
  [
    'closing the window',
    (app) =>
      app.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.close();
      }),
  ],
  ['quitting the app', (app) => app.evaluate(({ app: electronApp }) => electronApp.quit())],
];

for (const [wayToQuit, quit] of WAYS_TO_QUIT) {
  test(`${wayToQuit} during an export leaves no half-written video behind`, async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'holo-e2e-quit-'));
    const saveDir = mkdtempSync(join(tmpdir(), 'holo-e2e-quit-save-'));
    const { app, page } = await launchApp({ userDataDir });
    let hasExited = false;
    const exited = new Promise<void>((resolve) => {
      app.process().once('exit', () => {
        hasExited = true;
        resolve();
      });
    });

    try {
      // Long enough that the encode is still running when the app is told to go.
      const takeId = await recordAudioTake(page, 150);
      const takeDir = join(userDataDir, 'takes', takeId);
      const recordingId = await page.evaluate(async () => {
        const begun = await window.holo.take.begin({ mode: 'audio', sampleRate: 48000 });
        if (!begun.ok) throw new Error(`begin failed: ${begun.error.detail}`);
        const silence = new Float32Array(4800 * 2);
        window.holo.take.appendAudio(begun.value.takeId, {
          vocal: silence.buffer,
          backing: silence.buffer,
        });
        return begun.value.takeId;
      });

      // Start the export and wait until FFmpeg is well into the encode.
      await page.evaluate(
        ({ exportedTakeId, outputPath }) =>
          new Promise<void>((resolve) => {
            window.holo.exporter.onProgress(({ stage, fraction }) => {
              if (stage === 'encoding' && fraction >= 0.2) resolve();
            });
            void window.holo.exporter.start({ takeId: exportedTakeId, outputPath });
          }),
        { exportedTakeId: takeId, outputPath: join(saveDir, 'quit.mp4') },
      );
      // This is what must not be left behind.
      const duringExport = readdirSync(saveDir);
      expect(duringExport.length).toBe(1);
      expect(duringExport[0]).toMatch(/^quit\.[0-9a-f]{8}\.partial\.mp4$/);
      expect(existsSync(join(takeDir, 'mix.wav'))).toBe(true);
      expect(existsSync(join(userDataDir, 'takes', recordingId))).toBe(true);

      // The app may be gone before it can answer the call that made it quit.
      await quit(app).catch(() => undefined);
      await exited;

      expect(readdirSync(saveDir)).toEqual([]);
      // The finished take is untouched; its temporary mix and the unfinished recording are gone.
      expect(readdirSync(join(userDataDir, 'takes'))).toEqual([takeId]);
      expect(readdirSync(takeDir).sort()).toEqual(['backing.f32', 'manifest.json', 'vocal.f32']);
      // FFmpeg was started with the save folder on its command line; none may have survived.
      if (process.platform !== 'win32') expect(processesMentioning(saveDir)).toEqual([]);
    } finally {
      if (!hasExited) await app.close().catch(() => undefined);
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(saveDir, { recursive: true, force: true });
    }
  });
}

test('settings survive an app relaunch', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'holo-e2e-settings-'));
  try {
    const first = await launchApp({ userDataDir });
    let updated;
    try {
      expect(await first.page.evaluate(() => window.holo.settings.load())).toEqual(
        DEFAULT_SETTINGS,
      );
      updated = await first.page.evaluate(() =>
        window.holo.settings.update({
          onboardingComplete: true,
          mode: 'audio',
          audio: { micGain: 1.5, backingVolume: 7 },
          controls: { echo: { source: 'manual', manual: 0.25 } },
        }),
      );
      expect(updated).toEqual({
        ...DEFAULT_SETTINGS,
        onboardingComplete: true,
        mode: 'audio',
        // Out-of-range values are clamped by main, whatever the page sends.
        audio: { ...DEFAULT_SETTINGS.audio, micGain: 1.5, backingVolume: 1 },
        controls: { ...DEFAULT_SETTINGS.controls, echo: { source: 'manual', manual: 0.25 } },
      });
    } finally {
      await first.close();
    }

    const second = await launchApp({ userDataDir });
    try {
      expect(await second.page.evaluate(() => window.holo.settings.load())).toEqual(updated);
      expect(await second.page.evaluate(() => window.holo.settings.reset())).toEqual(
        DEFAULT_SETTINGS,
      );
      expect(await second.page.evaluate(() => window.holo.settings.load())).toEqual(
        DEFAULT_SETTINGS,
      );
    } finally {
      await second.close();
    }
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
