// The product's definition of done, headless: the real app, driven through window.__holoTest
// (the running Studio) with Chromium's synthetic camera and a synthesized voice as the
// microphone. Every take is exported and the MP4 is checked with ffprobe and by listening to
// its audio.
//
// Chromium's fake microphone cannot play a WAV while the audio service is sandboxed (it only
// beeps), so the voice is a tone generated in the page and handed to the app as the stream
// getUserMedia returns for audio, before the app opens the microphone.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { MANIFEST_FILE } from '../../src/main/takes/takeFiles';
import type { Studio, StudioActions, StudioState } from '../../src/renderer/src/state/studioTypes';
import type { TakeManifest } from '../../src/shared/take';
import { launchApp, type LaunchedApp } from './helpers/app';
import {
  bandPower,
  crossCorrelate,
  decodeMono,
  highPass,
  MIC_HZ,
  PILOT_HZ,
  toneProminence,
  writeCoreSongs,
  type CoreSongs,
} from './helpers/coreFixtures';
import { createFakeCameraClip, handFixture } from './helpers/fakeCamera';
import { probeMedia } from './helpers/takeFixtures';

interface TestWindow {
  __holoTest?: Studio;
}

/** Analysis rate for the exported audio: plenty for the 392 Hz voice and the 2750 Hz pilot. */
const MEASURE_RATE = 8000;
/** The backing track is compared above this frequency, well clear of the voice. */
const VOICE_CUTOFF_HZ = 1000;
/** RecordingController's BACKING_LEAD_SEC (that module cannot be loaded by Playwright). */
const BACKING_LEAD_SEC = 0.1;

let songs: CoreSongs;
let workDir: string;

test.beforeAll(() => {
  songs = writeCoreSongs();
  workDir = mkdtempSync(join(tmpdir(), 'holo-core-flow-'));
});

test.afterAll(() => {
  songs.dispose();
  rmSync(workDir, { recursive: true, force: true });
});

async function waitForStudio(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as TestWindow).__holoTest !== undefined);
}

function readState(page: Page): Promise<StudioState> {
  return page.evaluate(() => (window as TestWindow).__holoTest!.store.getState());
}

/** Calls a Studio action in the page and waits for it to finish. */
async function act<Name extends keyof StudioActions>(
  page: Page,
  name: Name,
  ...args: Parameters<StudioActions[Name]>
): Promise<void> {
  await page.evaluate(
    async ([actionName, actionArgs]) => {
      const actions = (window as TestWindow).__holoTest!.actions as unknown as Record<
        string,
        (...values: unknown[]) => unknown
      >;
      await actions[actionName]!(...actionArgs);
    },
    [name, args] as [string, unknown[]],
  );
}

/**
 * Makes every microphone the app opens a steady "sung" tone at MIC_HZ with a slow tremolo
 * (so the input meter moves). Camera requests still reach Chromium's synthetic camera.
 */
async function useSyntheticVoice(page: Page): Promise<void> {
  await page.evaluate((hz) => {
    const devices = navigator.mediaDevices;
    const nativeGetUserMedia = devices.getUserMedia.bind(devices);
    let context: AudioContext | null = null;
    devices.getUserMedia = async (constraints) => {
      if (!constraints?.audio) return nativeGetUserMedia(constraints);
      context ??= new AudioContext({ sampleRate: 48000 });
      await context.resume();
      const tone = new OscillatorNode(context, { frequency: hz });
      const level = new GainNode(context, { gain: 0.22 });
      const tremolo = new OscillatorNode(context, { frequency: 1.5 });
      const depth = new GainNode(context, { gain: 0.12 });
      const destination = new MediaStreamAudioDestinationNode(context, { channelCount: 1 });
      tremolo.connect(depth).connect(level.gain);
      tone.connect(level).connect(destination);
      tone.start();
      tremolo.start();
      return destination.stream;
    };
  }, MIC_HZ);
}

/** Gives the Studio a <video> to show the camera in, as the preview screens do. */
async function attachPreview(page: Page): Promise<void> {
  await page.evaluate(() => {
    const video = document.createElement('video');
    video.style.cssText = 'position:fixed;right:0;bottom:0;width:160px;height:90px';
    document.body.append(video);
    (window as TestWindow).__holoTest!.actions.attachPreview(video);
  });
}

async function stubSaveDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, chosenPath) => {
    const stub = async () => ({ canceled: chosenPath === null, filePath: chosenPath ?? '' });
    dialog.showSaveDialog = stub as typeof dialog.showSaveDialog;
  }, filePath);
}

async function stubOpenDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, chosenPath) => {
    const stub = async () => ({
      canceled: chosenPath === null,
      filePaths: chosenPath === null ? [] : [chosenPath],
    });
    dialog.showOpenDialog = stub as typeof dialog.showOpenDialog;
  }, filePath);
}

async function expectStatus(page: Page, status: StudioState['recording']['status']): Promise<void> {
  await expect.poll(async () => (await readState(page)).recording.status).toBe(status);
}

/** The manifest of the one temporary take the app keeps. */
function readTakeManifest(userDataDir: string): TakeManifest {
  const [takeId] = takeFolders(userDataDir);
  if (!takeId) throw new Error('There is no take folder');
  const path = join(userDataDir, 'takes', takeId, MANIFEST_FILE);
  return JSON.parse(readFileSync(path, 'utf8')) as TakeManifest;
}

/** Folders of temporary takes the app still keeps. */
function takeFolders(userDataDir: string): string[] {
  const takesDir = join(userDataDir, 'takes');
  return existsSync(takesDir) ? readdirSync(takesDir) : [];
}

interface RecordedTake {
  /** Recording time the app counted, pauses excluded. */
  elapsedSec: number;
  takeDurationSec: number;
}

/** Records for `seconds` (optionally with one pause in the middle) and stops into review. */
async function recordTake(
  page: Page,
  seconds: number,
  pause?: { afterSec: number; forSec: number },
): Promise<RecordedTake> {
  await act(page, 'startRecording');
  await expectStatus(page, 'recording');
  if (pause) {
    await page.waitForTimeout(pause.afterSec * 1000);
    await act(page, 'togglePause');
    await expectStatus(page, 'paused');
    await page.waitForTimeout(pause.forSec * 1000);
    await act(page, 'togglePause');
    await expectStatus(page, 'recording');
    await page.waitForTimeout((seconds - pause.afterSec) * 1000);
  } else {
    await page.waitForTimeout(seconds * 1000);
  }
  const elapsedSec = await page.evaluate(
    () => (window as TestWindow).__holoTest!.live.recordingElapsedSec,
  );
  await act(page, 'stopRecording');
  await expectStatus(page, 'review');
  const { takeDurationSec } = (await readState(page)).recording;
  return { elapsedSec, takeDurationSec };
}

/** Saves the take under review through the (stubbed) save dialog; returns the export time. */
async function saveTake(app: ElectronApplication, page: Page, fileName: string) {
  const outputPath = join(workDir, fileName);
  await stubSaveDialog(app, outputPath);
  const startedMs = Date.now();
  await act(page, 'saveTake');
  const exportMs = Date.now() - startedMs;
  const state = await readState(page);
  expect(state.recording.error).toBeNull();
  expect(state.recording.status).toBe('saved');
  expect(state.recording.savedPath).toBe(outputPath);
  return { outputPath, exportMs };
}

test('a fresh profile starts in the wizard; onboarding opens the studio and is remembered', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'holo-core-profile-'));
  try {
    let launched = await launchApp({ userDataDir });
    try {
      const { page } = launched;
      await waitForStudio(page);
      await expect.poll(async () => (await readState(page)).phase).toBe('wizard');
      let state = await readState(page);
      expect(state.engine.status).toBe('off');
      expect(state.camera.status).toBe('off');
      expect(state.devices.microphones.every((device) => device.id !== 'default')).toBe(true);

      await useSyntheticVoice(page);
      await attachPreview(page);
      await act(page, 'completeOnboarding');
      await expect.poll(async () => (await readState(page)).engine.status).toBe('running');
      await expect.poll(async () => (await readState(page)).camera.status).toBe('running');
      await expect
        .poll(async () => (await readState(page)).tracking.status, { timeout: 60_000 })
        .toBe('running');
      state = await readState(page);
      expect(state.phase).toBe('studio');
      console.log(
        `studio: camera ${state.camera.width}x${state.camera.height}, ` +
          `monitoring latency ${state.engine.monitoringLatencyMs} ms`,
      );

      const levels = await page.evaluate(async () => {
        const samples: number[] = [];
        for (let index = 0; index < 20; index++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          samples.push((window as TestWindow).__holoTest!.live.inputLevel);
        }
        return samples;
      });
      console.log(`input level over 2 s: ${levels.map((level) => level.toFixed(2)).join(' ')}`);
      expect(Math.max(...levels)).toBeGreaterThan(0.05);
      expect(new Set(levels.map((level) => level.toFixed(3))).size).toBeGreaterThan(3);

      await expect
        .poll(() =>
          page.evaluate(async () => (await window.holo.settings.load()).onboardingComplete),
        )
        .toBe(true);
    } finally {
      await launched.close();
    }

    launched = await launchApp({ userDataDir });
    try {
      const { page } = launched;
      await waitForStudio(page);
      await expect.poll(async () => (await readState(page)).phase).toBe('studio');
      await expect.poll(async () => (await readState(page)).engine.status).toBe('running');
    } finally {
      await launched.close();
    }
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test.describe.serial('recording and exporting', () => {
  let launched: LaunchedApp;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    launched = await launchApp();
    ({ app, page } = launched);
    await waitForStudio(page);
    await expect.poll(async () => (await readState(page)).phase).toBe('wizard');
    await useSyntheticVoice(page);
    await act(page, 'updateSettings', { recording: { countdownEnabled: false } });
    await attachPreview(page);
    await act(page, 'completeOnboarding');
    await expect.poll(async () => (await readState(page)).engine.status).toBe('running');
    await expect.poll(async () => (await readState(page)).camera.status).toBe('running');
  });

  test.afterAll(async () => {
    await launched.close();
  });

  test('backing and reference load; the reference is analysed once, then served from the cache', async () => {
    await stubOpenDialog(app, songs.backingPath);
    await act(page, 'chooseBackingTrack');
    let state = await readState(page);
    expect(state.backing.status).toBe('ready');
    expect(state.backing.file?.name).toBe('Backing Track.wav');
    expect(state.backing.file?.durationSec).toBeCloseTo(12, 1);

    const timedLoad = async () => {
      await page.evaluate(() => {
        const studio = (window as TestWindow).__holoTest!;
        const seen: string[] = [];
        (window as unknown as { __referenceStatuses: string[] }).__referenceStatuses = seen;
        studio.store.subscribe((next) => {
          if (seen.at(-1) !== next.reference.status) seen.push(next.reference.status);
        });
      });
      const startedMs = Date.now();
      await act(page, 'loadReferenceSong', songs.referencePath);
      const elapsedMs = Date.now() - startedMs;
      const statuses = await page.evaluate(
        () => (window as unknown as { __referenceStatuses: string[] }).__referenceStatuses,
      );
      return { elapsedMs, statuses };
    };

    const first = await timedLoad();
    state = await readState(page);
    expect(first.statuses).toEqual(['loading', 'analyzing', 'ready']);
    expect(state.reference.status).toBe('ready');
    expect(state.reference.keyLabel).not.toBeNull();

    const second = await timedLoad();
    expect(second.statuses).not.toContain('analyzing');
    expect((await readState(page)).reference.status).toBe('ready');
    console.log(
      `reference: key ${state.reference.keyLabel}, melody usable ${state.reference.melodyUsable}; ` +
        `analysed in ${first.elapsedMs} ms, from cache in ${second.elapsedMs} ms`,
    );
    expect(second.elapsedMs).toBeLessThan(first.elapsedMs);
  });

  test('a video take with a pause exports one synchronized MP4 without the reference', async () => {
    const take = await recordTake(page, 5, { afterSec: 2, forSec: 1 });
    const { outputPath, exportMs } = await saveTake(app, page, 'video-take.mp4');
    const media = await probeMedia(outputPath);
    console.log(
      `video take: counted ${take.elapsedSec.toFixed(2)} s, take ${take.takeDurationSec.toFixed(2)} s, ` +
        `export ${exportMs} ms; video ${media.video[0]?.codecName} ${media.video[0]?.durationSec.toFixed(2)} s ` +
        `${media.video[0]?.width}x${media.video[0]?.height}, audio ${media.audio[0]?.codecName} ` +
        `${media.audio[0]?.durationSec.toFixed(2)} s`,
    );
    expect(media.video).toHaveLength(1);
    expect(media.audio).toHaveLength(1);
    expect(media.video[0]?.codecName).toBe('h264');
    expect(media.audio[0]).toMatchObject({ codecName: 'aac', sampleRate: 48000, channels: 2 });
    expect(Math.abs((media.video[0]?.durationSec ?? 0) - take.elapsedSec)).toBeLessThan(0.5);
    expect(Math.abs((media.audio[0]?.durationSec ?? 0) - take.elapsedSec)).toBeLessThan(0.5);

    const exported = await decodeMono(outputPath, MEASURE_RATE);
    const backing = await decodeMono(songs.backingPath, MEASURE_RATE);
    const correlation = crossCorrelate(
      highPass(exported, MEASURE_RATE, VOICE_CUTOFF_HZ),
      highPass(backing, MEASURE_RATE, VOICE_CUTOFF_HZ),
      MEASURE_RATE,
      -1,
      1,
    );
    // Export time t plays the backing stem at t + startOffset, and the backing track started
    // BACKING_LEAD_SEC into the stem (src/renderer/src/recording/recordingController.ts).
    const manifest = readTakeManifest(launched.userDataDir);
    const expectedLagSec = (manifest.video?.startOffsetSec ?? 0) - BACKING_LEAD_SEC;
    const micProminence = toneProminence(exported, MEASURE_RATE, MIC_HZ);
    const pilotProminence = toneProminence(exported, MEASURE_RATE, PILOT_HZ);
    const referencePilot = toneProminence(
      await decodeMono(songs.referencePath, MEASURE_RATE),
      MEASURE_RATE,
      PILOT_HZ,
    );
    console.log(
      `video take audio: backing correlation peak ${correlation.peak.toFixed(3)} at ` +
        `${(correlation.lagSec * 1000).toFixed(1)} ms (manifest predicts ${(expectedLagSec * 1000).toFixed(1)} ms; ` +
        `runner-up ${correlation.runnerUp.toFixed(3)}); ` +
        `voice prominence ${micProminence.toFixed(1)}; pilot prominence ${pilotProminence.toFixed(2)} ` +
        `(in the reference itself ${referencePilot.toFixed(0)})`,
    );
    expect(correlation.peak).toBeGreaterThan(0.3);
    expect(correlation.runnerUp).toBeLessThan(correlation.peak * 0.6);
    expect(Math.abs(correlation.lagSec - expectedLagSec)).toBeLessThan(0.01);
    expect(micProminence).toBeGreaterThan(5);
    expect(referencePilot).toBeGreaterThan(100);
    expect(pilotProminence).toBeLessThan(3);

    await act(page, 'recordAnother');
    expect((await readState(page)).recording.status).toBe('idle');
    await expect.poll(() => takeFolders(launched.userDataDir)).toEqual([]);
  });

  test('an Audio Only take exports with artwork as a still picture', async () => {
    await act(page, 'setMode', 'audio');
    await expect.poll(async () => (await readState(page)).camera.status).toBe('off');
    const take = await recordTake(page, 3);
    const { outputPath, exportMs } = await saveTake(app, page, 'audio-only-take.mp4');
    const media = await probeMedia(outputPath);
    console.log(
      `audio-only take: ${take.takeDurationSec.toFixed(2)} s, export ${exportMs} ms; ` +
        `video ${media.video[0]?.codecName} ${media.video[0]?.width}x${media.video[0]?.height}, ` +
        `audio ${media.audio[0]?.codecName} ${media.audio[0]?.durationSec.toFixed(2)} s`,
    );
    expect(media.video).toHaveLength(1);
    expect(media.audio).toHaveLength(1);
    expect(media.video[0]?.codecName).toBe('h264');
    expect(Math.abs((media.audio[0]?.durationSec ?? 0) - take.elapsedSec)).toBeLessThan(0.5);
    await act(page, 'recordAnother');
    await expect.poll(() => takeFolders(launched.userDataDir)).toEqual([]);
  });

  test('manual vocal volume reaches the recording', async () => {
    await act(page, 'setControlSource', 'volume', 'manual');
    const voiceToBacking = async (volume: number, fileName: string): Promise<number> => {
      await act(page, 'setManualControl', 'volume', volume);
      await recordTake(page, 3);
      const { outputPath } = await saveTake(app, page, fileName);
      const audio = await decodeMono(outputPath, MEASURE_RATE);
      await act(page, 'recordAnother');
      // The backing's noise floor beside the pilot frequency is the yardstick.
      return bandPower(audio, MEASURE_RATE, MIC_HZ) / bandPower(audio, MEASURE_RATE, 2650);
    };
    const quiet = await voiceToBacking(0, 'volume-0.mp4');
    const loud = await voiceToBacking(1, 'volume-1.mp4');
    const differenceDb = 10 * Math.log10(loud / quiet);
    console.log(
      `vocal volume 0 -> 1 raises the voice by ${differenceDb.toFixed(1)} dB (17 dB nominal)`,
    );
    expect(differenceDb).toBeGreaterThan(10);
  });

  test('an a cappella take works without a backing track', async () => {
    await act(page, 'clearBackingTrack');
    expect((await readState(page)).backing.status).toBe('none');
    const take = await recordTake(page, 2);
    const { outputPath } = await saveTake(app, page, 'a-cappella.mp4');
    const media = await probeMedia(outputPath);
    expect(media.audio).toHaveLength(1);
    expect(Math.abs((media.audio[0]?.durationSec ?? 0) - take.elapsedSec)).toBeLessThan(0.5);
    const voice = toneProminence(await decodeMono(outputPath, MEASURE_RATE), MEASURE_RATE, MIC_HZ);
    console.log(
      `a cappella take: ${take.takeDurationSec.toFixed(2)} s, voice prominence ${voice.toFixed(1)}`,
    );
    expect(voice).toBeGreaterThan(5);
    await act(page, 'recordAnother');
    await expect.poll(() => takeFolders(launched.userDataDir)).toEqual([]);
  });

  test('discarding while recording and from review leaves no take behind', async () => {
    await act(page, 'startRecording');
    await expectStatus(page, 'recording');
    await page.waitForTimeout(1500);
    expect(takeFolders(launched.userDataDir)).toHaveLength(1);
    await act(page, 'discardTake');
    expect((await readState(page)).recording.status).toBe('idle');
    await expect.poll(() => takeFolders(launched.userDataDir)).toEqual([]);

    await recordTake(page, 1.5);
    expect(takeFolders(launched.userDataDir)).toHaveLength(1);
    await act(page, 'discardTake');
    expect((await readState(page)).recording.status).toBe('idle');
    await expect.poll(() => takeFolders(launched.userDataDir)).toEqual([]);
  });
});

test('a gesture control follows the hand while a manual one stays on its slider', async () => {
  const clip = createFakeCameraClip([
    {
      image: handFixture('right_hands.jpg'),
      crop: { x: 0.5, y: 0, width: 0.5, height: 1 },
      seconds: 2,
    },
  ]);
  const launched = await launchApp({ fakeVideo: clip.path });
  try {
    const { page } = launched;
    await waitForStudio(page);
    await act(page, 'updateSettings', {
      controls: {
        autotune: { source: 'gesture', manual: 0.2 },
        volume: { source: 'manual', manual: 0.3 },
      },
    });
    await attachPreview(page);
    await act(page, 'completeOnboarding');
    await expect
      .poll(async () => (await readState(page)).tracking.status, { timeout: 60_000 })
      .toBe('running');
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const { live } = (window as TestWindow).__holoTest!;
            return live.controlStatus.autotune === 'gesture' && live.controls.autotune > 0.9;
          }),
        { timeout: 30_000 },
      )
      .toBe(true);
    const live = await page.evaluate(() => {
      const readouts = (window as TestWindow).__holoTest!.live;
      return { controls: readouts.controls, status: readouts.controlStatus };
    });
    const camera = (await readState(page)).camera;
    console.log(
      `gesture: camera ${camera.width}x${camera.height}; controls ${JSON.stringify(live.controls)} ` +
        `${JSON.stringify(live.status)}`,
    );
    expect(live.status.volume).toBe('manual');
    expect(live.controls.volume).toBeCloseTo(0.3, 6);
  } finally {
    await launched.close();
    clip.dispose();
  }
});
