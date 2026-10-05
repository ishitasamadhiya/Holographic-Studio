// The real app, driven like a singer would: every click and key press goes through the UI.
// window.__holoTest is only read (state, live values) and waited on. Native dialogs are
// stubbed in the main process; the microphone is a synthesized voice; the camera is
// Chromium's synthetic one (or a photo of a hand). Screenshots of every stage are saved to
// test-results/app/ for visual review.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { SETTINGS_FILE_NAME } from '../../src/main/settings/settingsStore';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/settings';
import type { LaunchedApp } from './helpers/app';
import {
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
import {
  allowMicrophone,
  launchStudioApp,
  readLive,
  readState,
  readTakeManifest,
  reloadApp,
  reportPermission,
  stubOpenDialog,
  stubSaveDialog,
  takeFolders,
} from './helpers/studioDriver';
import { probeMedia } from './helpers/takeFixtures';

const screenshotDir = resolve(__dirname, '../../test-results/app');
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
  workDir = mkdtempSync(join(tmpdir(), 'holo-app-flow-'));
  mkdirSync(screenshotDir, { recursive: true });
});

test.afterAll(() => {
  songs.dispose();
  rmSync(workDir, { recursive: true, force: true });
});

async function shot(page: Page, name: string): Promise<void> {
  // Keep the pointer off the controls so no hover state leaks into a screenshot.
  await page.mouse.move(2, 400);
  // Let panels and sheets finish sliding in (endless animations, like a spinner, excepted).
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  await page.screenshot({ path: join(screenshotDir, `${name}.png`) });
}

/** Fails the test on any uncaught error in the page. */
function watchForCrashes(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

function radio(group: Locator, name: string): Locator {
  return group.getByRole('radio', { name, exact: true });
}

/** A wizard choice card, named by its title (its description follows in the name). */
function choiceCard(page: Page, title: string): Locator {
  return page
    .getByTestId('wizard-mode-choice')
    .getByRole('radio', { name: new RegExp(`^${title}`) });
}

async function expectStep(page: Page, step: string): Promise<void> {
  await expect(page.getByTestId('wizard-step')).toHaveAttribute('data-step', step);
}

/** Presses the step's main button and waits for the next step. */
async function continueTo(page: Page, next: string): Promise<void> {
  await page.getByTestId('wizard-primary').click();
  await expectStep(page, next);
}

/** Writes a settings file so the app starts straight in the studio. */
function returningProfile(patch: Partial<Settings> = {}): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'holo-app-profile-'));
  const settings: Settings = { ...DEFAULT_SETTINGS, onboardingComplete: true, ...patch };
  writeFileSync(join(userDataDir, SETTINGS_FILE_NAME), JSON.stringify(settings));
  return userDataDir;
}

/** Input-meter readings on every animation frame for `ms` (the meter's own refresh rate). */
async function sampleInputLevel(page: Page, ms: number): Promise<number[]> {
  return page.evaluate(
    (duration) =>
      new Promise<number[]>((done) => {
        const studio = (window as unknown as { __holoTest: { live: { inputLevel: number } } })
          .__holoTest;
        const samples: number[] = [];
        const started = performance.now();
        requestAnimationFrame(function sample(now) {
          samples.push(studio.live.inputLevel);
          if (now - started < duration) requestAnimationFrame(sample);
          else done(samples);
        });
      }),
    ms,
  );
}

async function moveSlider(slider: Locator, key: string, presses: number): Promise<void> {
  await slider.focus();
  for (let press = 0; press < presses; press++) await slider.press(key);
}

/** Leaves keyboard focus on the page itself, where the studio shortcuts listen. */
async function blurFocus(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

interface RecordedTake {
  elapsedSec: number;
}

/** Records with the record bar (count-in when enabled), optionally pausing once. */
async function recordWithUi(
  page: Page,
  seconds: number,
  options: { pause?: { afterSec: number; forSec: number }; screenshots?: boolean } = {},
): Promise<RecordedTake> {
  const bar = page.getByTestId('record-bar');
  await page.getByTestId('record-button').click();
  const settings = (await readState(page)).settings;
  if (settings.recording.countdownEnabled) {
    await expect(page.getByTestId('countdown')).toBeVisible();
    await expect(bar).toHaveAttribute('data-status', 'countdown');
    // The mode cannot change once a take is under way.
    await expect(radio(page.getByTestId('mode-switch'), 'Audio Only')).toBeDisabled();
    if (options.screenshots) await shot(page, 'studio-countdown');
  }
  await expect(page.getByTestId('record-status-label')).toHaveText('Recording', {
    timeout: 15_000,
  });
  await expect(radio(page.getByTestId('mode-switch'), 'Video')).toBeDisabled();
  const { pause } = options;
  if (pause) {
    await page.waitForTimeout(pause.afterSec * 1000);
    if (options.screenshots) await shot(page, 'studio-recording');
    await page.getByTestId('pause-button').click();
    await expect(page.getByTestId('record-status-label')).toHaveText('Paused');
    await page.waitForTimeout(pause.forSec * 1000);
    if (options.screenshots) await shot(page, 'studio-paused');
    await page.getByTestId('pause-button').click();
    await expect(page.getByTestId('record-status-label')).toHaveText('Recording');
    await page.waitForTimeout((seconds - pause.afterSec) * 1000);
  } else {
    await page.waitForTimeout(seconds * 1000);
  }
  const { recordingElapsedSec } = await readLive(page);
  await page.getByTestId('record-button').click();
  await expect(page.getByTestId('export-dialog')).toHaveAttribute('data-view', 'review', {
    timeout: 15_000,
  });
  return { elapsedSec: recordingElapsedSec };
}

/** Saves the take under review through the dialog; returns the progress values it showed. */
async function saveWithUi(
  app: ElectronApplication,
  page: Page,
  fileName: string,
  screenshots = false,
): Promise<{ outputPath: string; progress: number[] }> {
  const outputPath = join(workDir, fileName);
  await stubSaveDialog(app, outputPath);
  const dialog = page.getByTestId('export-dialog');
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { __exportProgress: number[] }).__exportProgress = seen;
    const observer = new MutationObserver(() => {
      const bar = document.querySelector('[data-testid="export-progress"]');
      const value = Number(bar?.getAttribute('aria-valuenow') ?? Number.NaN);
      if (Number.isFinite(value) && seen.at(-1) !== value) seen.push(value);
    });
    observer.observe(document.body, { subtree: true, attributes: true, childList: true });
  });
  await page.getByTestId('export-save').click();
  if (screenshots) {
    await expect(dialog).toHaveAttribute('data-view', 'exporting');
    await shot(page, 'studio-exporting');
  }
  await expect(dialog).toContainText('Saved successfully', { timeout: 60_000 });
  await expect(page.getByTestId('export-file-name')).toHaveText(basename(outputPath));
  const progress = await page.evaluate(
    () => (window as unknown as { __exportProgress: number[] }).__exportProgress,
  );
  return { outputPath, progress };
}

// ---------------------------------------------------------------------------------------
// a + c: video mode, from a fresh profile to a saved take, then a relaunch
// ---------------------------------------------------------------------------------------

test.describe.serial('video mode through the real UI', () => {
  let userDataDir: string;
  let launched: LaunchedApp;
  let app: ElectronApplication;
  let page: Page;
  let pageErrors: string[];

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'holo-app-video-'));
    launched = await launchStudioApp({ userDataDir });
    ({ app, page } = launched);
    pageErrors = watchForCrashes(page);
  });

  test.afterAll(async () => {
    await launched?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('a fresh profile walks every wizard step into the studio', async () => {
    await expect(page.getByTestId('wizard-screen')).toBeVisible();

    // 1. Microphone: it opens right away, but monitoring stays off until "Hear yourself".
    await expectStep(page, 'microphone');
    await expect.poll(async () => (await readState(page)).engine.status).toBe('running');
    let state = await readState(page);
    expect(state.permissions.microphone).toBe('granted');
    expect(state.settings.audio.monitoringEnabled).toBe(false);
    expect(state.devices.microphones.length).toBeGreaterThan(0);
    await expect(page.getByTestId('wizard-microphone-select')).toBeVisible();
    // Once the voice reaches the meter, it is fed every frame and never flickers back to zero.
    await expect.poll(async () => (await readLive(page)).inputLevel).toBeGreaterThan(0.05);
    const levels = await sampleInputLevel(page, 1500);
    const zeros = levels.filter((level) => level === 0).length;
    console.log(
      `wizard mic meter: ${levels.length} frames, ${zeros} at zero, ` +
        `range ${Math.min(...levels).toFixed(3)}..${Math.max(...levels).toFixed(3)}`,
    );
    expect(Math.min(...levels)).toBeGreaterThan(0.05);
    expect(new Set(levels.map((level) => level.toFixed(2))).size).toBeGreaterThan(5);
    expect(zeros).toBe(0);
    await shot(page, 'wizard-01-microphone');

    // 2. Camera or Audio Only: Video is the default and the camera shows itself.
    await continueTo(page, 'mode');
    await expect(choiceCard(page, 'Video')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('wizard-camera-preview')).toHaveAttribute(
      'data-status',
      'running',
    );
    await shot(page, 'wizard-02-mode');

    // 3. Headphones.
    await continueTo(page, 'headphones');
    await expect(page.getByTestId('wizard-step-body')).toContainText('Use headphones.');
    await shot(page, 'wizard-03-headphones');

    // 4. Microphone test.
    await continueTo(page, 'mic-test');
    await expect(page.getByTestId('wizard-mic-test-status')).toHaveText('We can hear you');
    await shot(page, 'wizard-04-mic-test');

    // 5. Headphone test: play the chime, then confirm it was heard.
    await continueTo(page, 'headphone-test');
    await expect(page.getByTestId('wizard-primary')).toHaveText('Play test sound');
    await page.getByTestId('wizard-primary').click();
    await expect(page.getByTestId('wizard-primary')).toHaveText('I heard it');
    await shot(page, 'wizard-05-headphone-test');

    // 6. Hear yourself: monitoring comes on here, and the echo slider is live.
    await continueTo(page, 'monitoring');
    await expect
      .poll(async () => (await readState(page)).settings.audio.monitoringEnabled)
      .toBe(true);
    await expect(page.getByTestId('wizard-monitoring-toggle')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await moveSlider(page.getByTestId('wizard-echo-slider'), 'ArrowRight', 20);
    await expect.poll(async () => (await readLive(page)).controls.echo).toBeCloseTo(0.2, 2);
    await shot(page, 'wizard-06-monitoring');

    // 7. Try your hands: the camera and hand tracking run; nobody is in view to calibrate.
    await continueTo(page, 'hands');
    state = await readState(page);
    // Leaving "Hear yourself" hands echo back to the gesture, as it was.
    expect(state.settings.controls.echo).toEqual({ source: 'gesture', manual: 0 });
    await expect(page.getByTestId('wizard-camera-preview')).toHaveAttribute(
      'data-status',
      'running',
    );
    await expect
      .poll(async () => (await readState(page)).tracking.status, { timeout: 60_000 })
      .toBe('running');
    for (const control of ['autotune', 'volume', 'echo']) {
      await expect(page.getByTestId(`wizard-indicator-${control}`)).toBeVisible();
    }
    await page.getByTestId('wizard-calibrate').click();
    await expect(page.getByTestId('wizard-calibrate-status')).toContainText(
      'could not see your right hand',
    );
    await shot(page, 'wizard-07-hands');
    // The busiest step still fits the smallest window the app allows.
    await page.setViewportSize({ width: 960, height: 620 });
    const primary = await page.getByTestId('wizard-primary').boundingBox();
    expect((primary?.y ?? Infinity) + (primary?.height ?? 0)).toBeLessThanOrEqual(620);
    await shot(page, 'wizard-07-hands-smallest-window');
    await page.setViewportSize({ width: 1280, height: 800 });

    // 8. Backing track, chosen through the native open dialog.
    await continueTo(page, 'backing');
    await stubOpenDialog(app, songs.backingPath);
    await expect(page.getByTestId('wizard-primary')).toHaveText('Choose a file');
    await page.getByTestId('wizard-primary').click();
    await expect(page.getByTestId('wizard-backing-zone')).toContainText('Backing Track.wav');
    await expect(page.getByTestId('wizard-primary')).toHaveText('Continue');
    await shot(page, 'wizard-08-backing');

    // 9. Original song.
    await continueTo(page, 'reference');
    await stubOpenDialog(app, songs.referencePath);
    await page.getByTestId('wizard-primary').click();
    await expect(page.getByTestId('wizard-reference-zone')).toContainText('Reference Song.wav');
    await shot(page, 'wizard-09-reference');

    // 10. Melody analysis.
    await continueTo(page, 'melody');
    await expect(page.getByTestId('wizard-melody')).toHaveAttribute('data-status', 'ready', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('wizard-melody-status')).toHaveText('Reference melody ready');
    state = await readState(page);
    console.log(
      `reference: key ${state.reference.keyLabel}, melody usable ${state.reference.melodyUsable}`,
    );
    await shot(page, 'wizard-10-melody');

    // 11. Ready: the summary, then the studio.
    await continueTo(page, 'ready');
    await expect(page.getByTestId('wizard-summary')).toContainText('Backing Track.wav');
    await shot(page, 'wizard-11-ready');
    await expect(page.getByTestId('wizard-primary')).toHaveText('Enter Studio');
    await page.getByTestId('wizard-primary').click();

    await expect(page.getByTestId('studio-screen')).toHaveAttribute('data-mode', 'video');
    const preview = page.getByTestId('camera-preview');
    await expect
      .poll(() => preview.evaluate((video: HTMLVideoElement) => video.videoWidth))
      .toBeGreaterThan(0);
    const looks = await preview.evaluate((video: HTMLVideoElement) => ({
      transform: getComputedStyle(video).transform,
      box: video.getBoundingClientRect().toJSON() as DOMRect,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }));
    expect(looks.transform).toBe('matrix(-1, 0, 0, 1, 0, 0)');
    expect(looks.box.width).toBe(looks.viewport.width);
    expect(looks.box.height).toBe(looks.viewport.height);
    await expect(page.getByTestId('edge-left').getByTestId('indicator-echo')).toBeVisible();
    await expect(page.getByTestId('edge-right').getByTestId('indicator-autotune')).toBeVisible();
    await expect(page.getByTestId('edge-right').getByTestId('indicator-volume')).toBeVisible();
    await expect(page.getByTestId('record-bar')).toHaveAttribute('data-status', 'idle');
    await expect(page.getByTestId('record-button')).toBeEnabled();
    await expect(page.getByTestId('backing-chip')).toContainText('Backing Track.wav');
    await expect(page.getByTestId('reference-chip')).toContainText('Reference melody ready');
    await expect(page.getByTestId('headphones-banner')).toBeVisible();
    await expect(page.getByTestId('problem-card')).toHaveCount(0);
    expect((await readState(page)).settings.onboardingComplete).toBe(true);
    await page.waitForTimeout(500);
    await shot(page, 'studio-idle');
    expect(pageErrors).toEqual([]);
  });

  test('the controls panel and the shortcuts change the controls', async () => {
    await page.getByTestId('controls-button').click();
    const panel = page.getByTestId('controls-panel');
    await expect(panel).toBeVisible();
    await shot(page, 'studio-controls-panel');

    // Echo to Manual; its slider then sets the live value.
    await radio(page.getByTestId('control-row-echo'), 'Manual').click();
    await expect(page.getByTestId('control-row-echo')).toHaveAttribute('data-source', 'manual');
    await moveSlider(page.getByTestId('control-row-echo').getByRole('slider'), 'ArrowRight', 10);
    await expect.poll(async () => (await readLive(page)).controls.echo).toBeCloseTo(0.1, 2);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // The arrow keys nudge the manual echo.
    await blurFocus(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await readLive(page)).controls.echo).toBeCloseTo(0.2, 2);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await readLive(page)).controls.echo).toBeCloseTo(0.15, 2);
    await expect(page.getByTestId('indicator-echo')).toHaveAttribute('data-status', 'manual');
    await expect(page.getByTestId('indicator-echo')).toContainText('15%');

    // Back to the gesture, so the take below is recorded as a singer would.
    await page.getByTestId('controls-button').click();
    await radio(page.getByTestId('control-row-echo'), 'Gesture').click();
    await page.keyboard.press('Escape');
  });

  test('a take recorded with the record bar is saved as one synchronized MP4', async () => {
    const take = await recordWithUi(page, 4, {
      pause: { afterSec: 2, forSec: 1 },
      screenshots: true,
    });
    await expect(page.getByTestId('export-take-length')).toContainText('4 sec');
    await shot(page, 'studio-review');

    const { outputPath, progress } = await saveWithUi(app, page, 'video-take.mp4', true);
    await shot(page, 'studio-saved');
    console.log(`export progress shown: ${progress.map((value) => value.toFixed(0)).join(' ')}`);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));

    const media = await probeMedia(outputPath);
    console.log(
      `video take: counted ${take.elapsedSec.toFixed(2)} s; video ${media.video[0]?.codecName} ` +
        `${media.video[0]?.durationSec.toFixed(2)} s ${media.video[0]?.width}x${media.video[0]?.height}, ` +
        `audio ${media.audio[0]?.codecName} ${media.audio[0]?.sampleRate} Hz ` +
        `${media.audio[0]?.channels} ch ${media.audio[0]?.durationSec.toFixed(2)} s`,
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
    const manifest = readTakeManifest(userDataDir);
    const expectedLagSec = (manifest.video?.startOffsetSec ?? 0) - BACKING_LEAD_SEC;
    const voice = toneProminence(exported, MEASURE_RATE, MIC_HZ);
    const pilot = toneProminence(exported, MEASURE_RATE, PILOT_HZ);
    console.log(
      `video take audio: backing correlation ${correlation.peak.toFixed(3)} at ` +
        `${(correlation.lagSec * 1000).toFixed(1)} ms (manifest predicts ` +
        `${(expectedLagSec * 1000).toFixed(1)} ms, runner-up ${correlation.runnerUp.toFixed(3)}); ` +
        `voice prominence ${voice.toFixed(1)}; reference pilot prominence ${pilot.toFixed(2)}`,
    );
    expect(correlation.peak).toBeGreaterThan(0.3);
    expect(correlation.runnerUp).toBeLessThan(correlation.peak * 0.6);
    expect(Math.abs(correlation.lagSec - expectedLagSec)).toBeLessThan(0.01);
    expect(voice).toBeGreaterThan(5);
    expect(pilot).toBeLessThan(3);

    await page.getByTestId('export-record-another').click();
    await expect(page.getByTestId('export-dialog')).toHaveCount(0);
    await expect(page.getByTestId('record-bar')).toHaveAttribute('data-status', 'idle');
    await expect.poll(() => takeFolders(userDataDir)).toEqual([]);
  });

  test('a count-in can be called off and leaves nothing behind', async () => {
    await page.getByTestId('record-button').click();
    await expect(page.getByTestId('countdown')).toBeVisible();
    await page.getByTestId('countdown-cancel').click();
    await expect(page.getByTestId('record-bar')).toHaveAttribute('data-status', 'idle');
    // Long enough for the take that the count-in would have started.
    await page.waitForTimeout(3500);
    expect((await readState(page)).recording.status).toBe('idle');
    expect(takeFolders(userDataDir)).toEqual([]);
  });

  test('settings changed in the sheet apply at once', async () => {
    await page.getByTestId('studio-settings-button').click();
    const sheet = page.getByTestId('settings-sheet');
    await expect(sheet).toBeVisible();
    await shot(page, 'studio-settings-sheet');
    await sheet.getByTestId('settings-countdown').click();
    await expect(sheet.getByTestId('settings-countdown')).toHaveAttribute('aria-checked', 'false');
    await moveSlider(sheet.getByTestId('settings-backing-volume'), 'ArrowLeft', 10);
    await expect
      .poll(async () => (await readState(page)).settings.audio.backingVolume)
      .toBeCloseTo(0.7, 5);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('a relaunch opens the studio with the same settings; setup can run again', async () => {
    await launched.close();
    launched = await launchStudioApp({ userDataDir });
    ({ app, page } = launched);
    pageErrors = watchForCrashes(page);

    await expect(page.getByTestId('studio-screen')).toBeVisible();
    await expect(page.getByTestId('wizard-screen')).toHaveCount(0);
    // The songs of the last session come back.
    await expect(page.getByTestId('backing-chip')).toContainText('Backing Track.wav');
    await expect(page.getByTestId('reference-chip')).toContainText('Reference melody ready');

    await page.getByTestId('studio-settings-button').click();
    const sheet = page.getByTestId('settings-sheet');
    await expect(sheet.getByTestId('settings-countdown')).toHaveAttribute('aria-checked', 'false');
    await expect(sheet.getByTestId('settings-backing-volume')).toHaveAttribute(
      'aria-valuenow',
      '0.7',
    );
    await sheet.getByTestId('settings-advanced-toggle').click();
    await sheet.getByTestId('settings-run-setup').click();
    await expect(page.getByTestId('wizard-screen')).toBeVisible();
    await expectStep(page, 'microphone');
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// b: Audio Only chosen in the wizard
// ---------------------------------------------------------------------------------------

test('Audio Only: the wizard skips the hands, the sliders are docked, the take has a still picture', async () => {
  const launched = await launchStudioApp();
  const { app, page, userDataDir } = launched;
  const pageErrors = watchForCrashes(page);
  try {
    await expectStep(page, 'microphone');
    await continueTo(page, 'mode');
    await choiceCard(page, 'Audio Only').click();
    await expect.poll(async () => (await readState(page)).settings.mode).toBe('audio');
    await expect(page.getByTestId('wizard-camera-preview')).toHaveCount(0);
    await expect.poll(async () => (await readState(page)).camera.status).toBe('off');
    await shot(page, 'wizard-02-mode-audio-only');
    await continueTo(page, 'headphones');
    await continueTo(page, 'mic-test');
    await continueTo(page, 'headphone-test');
    await page.getByTestId('wizard-primary').click();
    await expect(page.getByTestId('wizard-primary')).toHaveText('I heard it');
    await continueTo(page, 'monitoring');
    // No camera, no hands: straight on to the backing track.
    await continueTo(page, 'backing');
    await stubOpenDialog(app, songs.backingPath);
    await page.getByTestId('wizard-primary').click();
    await expect(page.getByTestId('wizard-backing-zone')).toContainText('Backing Track.wav');
    await continueTo(page, 'reference');
    await page.getByTestId('wizard-secondary').click();
    await expectStep(page, 'ready');
    await expect(page.getByTestId('wizard-step-count')).toHaveText('Step 9 of 9');
    await page.getByTestId('wizard-primary').click();

    await expect(page.getByTestId('studio-screen')).toHaveAttribute('data-mode', 'audio');
    await expect(page.getByTestId('audio-stage')).toBeVisible();
    await expect(page.getByTestId('camera-preview')).toHaveCount(0);
    await expect(page.getByTestId('controls-panel')).toHaveAttribute('data-docked', 'true');
    await expect(page.getByTestId('indicator-autotune')).toHaveCount(0);
    expect((await readState(page)).camera.status).toBe('off');
    await page.waitForTimeout(500);
    await shot(page, 'studio-audio-only');

    // The docked sliders...
    await moveSlider(
      page.getByTestId('control-row-autotune').getByRole('slider'),
      'ArrowRight',
      10,
    );
    await expect.poll(async () => (await readLive(page)).controls.autotune).toBeCloseTo(0.6, 2);
    // ...and the keyboard shortcuts.
    await blurFocus(page);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Equal');
    await page.keyboard.press('Equal');
    await expect
      .poll(async () => (await readLive(page)).controls)
      .toEqual({
        autotune: 0.65,
        echo: 0.05,
        volume: 0.6,
      });
    const live = await readLive(page);
    expect(live.controlStatus).toEqual({ autotune: 'manual', echo: 'manual', volume: 'manual' });
    await page.keyboard.press('Minus');
    await expect.poll(async () => (await readLive(page)).controls.volume).toBeCloseTo(0.55, 5);

    const take = await recordWithUi(page, 3);
    const { outputPath } = await saveWithUi(app, page, 'audio-only-take.mp4');
    const media = await probeMedia(outputPath);
    console.log(
      `audio-only take: counted ${take.elapsedSec.toFixed(2)} s; video ${media.video[0]?.codecName} ` +
        `${media.video[0]?.width}x${media.video[0]?.height}, audio ${media.audio[0]?.codecName} ` +
        `${media.audio[0]?.durationSec.toFixed(2)} s`,
    );
    expect(media.video).toHaveLength(1);
    expect(media.video[0]?.codecName).toBe('h264');
    expect(media.audio).toHaveLength(1);
    expect(media.audio[0]).toMatchObject({ codecName: 'aac', sampleRate: 48000, channels: 2 });
    expect(Math.abs((media.audio[0]?.durationSec ?? 0) - take.elapsedSec)).toBeLessThan(0.5);
    const voice = toneProminence(await decodeMono(outputPath, MEASURE_RATE), MEASURE_RATE, MIC_HZ);
    expect(voice).toBeGreaterThan(5);

    await page.getByTestId('export-record-another').click();
    await expect(page.getByTestId('record-bar')).toHaveAttribute('data-status', 'idle');
    await expect.poll(() => takeFolders(userDataDir)).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await launched.close();
  }
});

// ---------------------------------------------------------------------------------------
// d: a hand in front of the camera
// ---------------------------------------------------------------------------------------

test('an open right hand drives autotune while volume, set to Manual, stays on its slider', async () => {
  const clip = createFakeCameraClip([
    {
      image: handFixture('right_hands.jpg'),
      crop: { x: 0.5, y: 0, width: 0.5, height: 1 },
      seconds: 2,
    },
  ]);
  const userDataDir = returningProfile({
    controls: { ...DEFAULT_SETTINGS.controls, autotune: { source: 'gesture', manual: 0.2 } },
  });
  const launched = await launchStudioApp({ userDataDir, fakeVideo: clip.path });
  const { page } = launched;
  const pageErrors = watchForCrashes(page);
  try {
    await expect(page.getByTestId('studio-screen')).toHaveAttribute('data-mode', 'video');
    await expect
      .poll(async () => (await readState(page)).tracking.status, { timeout: 60_000 })
      .toBe('running');

    await page.getByTestId('controls-button').click();
    const volumeRow = page.getByTestId('control-row-volume');
    await radio(volumeRow, 'Manual').click();
    await expect(volumeRow).toHaveAttribute('data-source', 'manual');
    await moveSlider(volumeRow.getByRole('slider'), 'ArrowLeft', 20);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('controls-panel')).toHaveCount(0);

    const autotune = page.getByTestId('indicator-autotune');
    await expect(autotune).toHaveAttribute('data-status', 'gesture-live', { timeout: 30_000 });
    await expect
      .poll(async () => (await readLive(page)).controls.autotune, { timeout: 30_000 })
      .toBeGreaterThan(0.9);
    await expect(autotune).toContainText(/(9\d|100)%/);
    const volume = page.getByTestId('indicator-volume');
    await expect(volume).toHaveAttribute('data-status', 'manual');
    await expect(volume).toContainText('30%');
    const live = await readLive(page);
    console.log(
      `gesture: controls ${JSON.stringify(live.controls)} ${JSON.stringify(live.controlStatus)}`,
    );
    expect(live.controlStatus.volume).toBe('manual');
    expect(live.controls.volume).toBeCloseTo(0.3, 6);
    await shot(page, 'studio-gesture-hand');
    expect(pageErrors).toEqual([]);
  } finally {
    await launched.close();
    rmSync(userDataDir, { recursive: true, force: true });
    clip.dispose();
  }
});

// ---------------------------------------------------------------------------------------
// e: microphone access refused
// ---------------------------------------------------------------------------------------

test('with microphone access refused the wizard and the studio explain it and recover', async () => {
  const launched = await launchStudioApp({ microphoneBlocked: true });
  const { app, page } = launched;
  const pageErrors = watchForCrashes(page);
  try {
    await reportPermission(app, 'microphone', 'denied');
    await reloadApp(page);

    // The wizard: the friendly message, System Settings, and a way to check again.
    await expectStep(page, 'microphone');
    const blocked = page.getByTestId('wizard-microphone-blocked');
    await expect(blocked).toContainText('not allowed to use the microphone');
    await expect(page.getByTestId('wizard-primary')).toHaveText('Open System Settings');
    await expect(page.getByTestId('wizard-secondary')).toHaveText('Not now');
    await page.getByTestId('wizard-primary').click();
    await blocked.getByRole('button', { name: 'Check again' }).click();
    await expect(blocked).toBeVisible();
    expect((await readState(page)).engine.status).toBe('off');
    await shot(page, 'error-wizard-microphone');

    // Access granted in System Settings: "Check again" opens the microphone.
    await reportPermission(app, 'microphone', 'granted');
    await allowMicrophone(page);
    await blocked.getByRole('button', { name: 'Check again' }).click();
    await expect(blocked).toHaveCount(0);
    await expect.poll(async () => (await readState(page)).permissions.microphone).toBe('granted');
    await expect.poll(async () => (await readState(page)).engine.status).toBe('running');
    await expect(page.getByTestId('wizard-microphone-select')).toBeVisible();

    // The studio of a returning singer whose access was taken away since.
    await page.evaluate(() => window.holo.settings.update({ onboardingComplete: true }));
    await reportPermission(app, 'microphone', 'denied');
    await reloadApp(page);
    const card = page.getByTestId('problem-card');
    await expect(card).toHaveAttribute('data-source', 'microphone');
    await expect(card).toContainText('Microphone access is off');
    await expect(card).toContainText('not allowed to use the microphone');
    await expect(page.getByTestId('problem-action-open-system-settings')).toBeVisible();
    await expect(page.getByTestId('record-button')).toBeDisabled();
    // Trying again while access is still off changes nothing, and the card's message is not
    // repeated as a toast.
    await page.getByTestId('problem-action-retry').click();
    await page.getByTestId('problem-action-open-system-settings').click();
    await expect(card).toBeVisible();
    await expect(page.getByTestId('toast')).toHaveCount(0);
    await shot(page, 'error-studio-card');

    await reportPermission(app, 'microphone', 'granted');
    await allowMicrophone(page);
    await page.getByTestId('problem-action-retry').click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId('record-button')).toBeEnabled();
    expect((await readState(page)).engine.status).toBe('running');
    // Nothing about the solved problem pops up afterwards.
    await page.waitForTimeout(500);
    await expect(page.getByTestId('toast')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await launched.close();
  }
});

// ---------------------------------------------------------------------------------------
// Closing the window in the middle of things
// ---------------------------------------------------------------------------------------

async function closeWindowAndWait(app: ElectronApplication): Promise<void> {
  const exited = new Promise<void>((done) => app.process().once('exit', () => done()));
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.close();
    })
    .catch(() => undefined);
  await exited;
}

test('closing the window during a take or an export leaves no partial files', async () => {
  const userDataDir = returningProfile({
    recording: { countdownEnabled: false, countdownSec: 3 },
  });
  const saveDir = mkdtempSync(join(tmpdir(), 'holo-app-close-'));
  try {
    // During a take.
    let launched = await launchStudioApp({ userDataDir });
    let { page } = launched;
    await expect(page.getByTestId('record-button')).toBeEnabled();
    await page.getByTestId('record-button').click();
    await expect(page.getByTestId('record-status-label')).toHaveText('Recording');
    await page.waitForTimeout(1500);
    expect(takeFolders(userDataDir)).toHaveLength(1);
    await closeWindowAndWait(launched.app);
    expect(takeFolders(userDataDir)).toEqual([]);

    // During an export.
    launched = await launchStudioApp({ userDataDir });
    ({ page } = launched);
    await expect(page.getByTestId('record-button')).toBeEnabled();
    await recordWithUi(page, 6);
    await stubSaveDialog(launched.app, join(saveDir, 'closed.mp4'));
    await page.getByTestId('export-save').click();
    await expect(page.getByTestId('export-dialog')).toHaveAttribute('data-view', 'exporting');
    await closeWindowAndWait(launched.app);
    const left = existsSync(saveDir) ? readdirSync(saveDir) : [];
    console.log(`after closing during the export the save folder holds: [${left.join(', ')}]`);
    expect(left.filter((name) => name.includes('.partial.'))).toEqual([]);
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(saveDir, { recursive: true, force: true });
  }
});
