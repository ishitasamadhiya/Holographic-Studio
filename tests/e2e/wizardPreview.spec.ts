// The setup wizard, step by step, against the fixed app states of wizard-preview.html.
// The wizard only talks to the app through StudioActions, so every interaction is checked
// by reading the calls it made on window.__staticStudio. A screenshot of every step and
// variant is saved to test-results/wizard/ for review.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FRIENDLY_ERROR_MESSAGES } from '../../src/shared/errors';
import { launchApp, type LaunchedApp } from './helpers/app';

const screenshotDir = resolve(__dirname, '../../test-results/wizard');

/** The parts of the preview's StaticStudio these tests use (see src/renderer/src/dev). */
interface PreviewStudio {
  calls: { name: string; args: unknown[] }[];
  store: {
    getState(): Record<string, unknown>;
    setState(state: Record<string, unknown>, replace: true): void;
  };
  live: Record<string, unknown>;
}

type PreviewWindow = Window & { __staticStudio: PreviewStudio };

/** An action call as the page reports it; DOM elements are reported as "<TAG>". */
type Call = [name: string, ...args: unknown[]];

let launched: LaunchedApp;
let page: Page;
let songDir: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  launched = await launchApp({ page: 'wizard-preview.html' });
  page = launched.page;
  songDir = mkdtempSync(join(tmpdir(), 'holo-wizard-'));
});

test.afterAll(async () => {
  await launched?.close();
  if (songDir) rmSync(songDir, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Opens a step/variant on a fresh page, so no state or recorded call carries over. */
async function openFixture(step: number | string, variant?: string): Promise<void> {
  const hash = variant ? `step=${step}&variant=${variant}` : `step=${step}`;
  await page.evaluate((next) => {
    window.location.hash = next;
  }, hash);
  await page.reload();
  await expect(page.getByTestId('wizard-step')).toBeVisible();
  // Park the pointer away from the card so no hover state shows in screenshots.
  await page.mouse.move(5, 300);
}

async function allCalls(): Promise<Call[]> {
  return page.evaluate(() =>
    (window as unknown as PreviewWindow).__staticStudio.calls.map(({ name, args }): Call => [
      name,
      ...args.map((arg) => (arg instanceof Element ? `<${arg.tagName}>` : arg)),
    ]),
  );
}

/** The argument lists of every call to one action, in order. */
async function callsTo(name: string): Promise<unknown[][]> {
  return (await allCalls()).filter(([called]) => called === name).map(([, ...args]) => args);
}

/** Plays the app's part: deep-merges `patch` into the app state. */
async function patchState(patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((overlay) => {
    const isObject = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);
    const merge = (base: unknown, over: unknown): unknown => {
      if (!isObject(base) || !isObject(over)) return over;
      const merged: Record<string, unknown> = { ...base };
      for (const [key, value] of Object.entries(over)) merged[key] = merge(merged[key], value);
      return merged;
    };
    const { store } = (window as unknown as PreviewWindow).__staticStudio;
    store.setState(merge(store.getState(), overlay) as Record<string, unknown>, true);
  }, patch);
}

/**
 * Plays the app's part for values that change every frame. The live readouts are one object
 * that the app mutates in place, so the patch is written into it rather than replacing it.
 */
async function patchLive(patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((overlay) => {
    const isObject = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);
    const assignInto = (target: Record<string, unknown>, over: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(over)) {
        const current = target[key];
        if (isObject(current) && isObject(value)) assignInto(current, value);
        else target[key] = value;
      }
    };
    assignInto((window as unknown as PreviewWindow).__staticStudio.live, overlay);
  }, patch);
}

const shownStep = () => page.getByTestId('wizard-step');
const primary = () => page.getByTestId('wizard-primary');
const secondary = () => page.getByTestId('wizard-secondary');
const back = () => page.getByTestId('wizard-back');
const stepBody = () => page.getByTestId('wizard-step-body');

async function expectStep(id: string, position?: string): Promise<void> {
  await expect(shownStep()).toHaveAttribute('data-step', id);
  if (position) await expect(page.getByTestId('wizard-step-count')).toHaveText(position);
}

/** Writes a short silent WAV file and returns its path. */
function writeSong(name: string): string {
  const sampleRate = 8000;
  const samples = 800;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples * 2, 40);
  const path = join(songDir, name);
  writeFileSync(path, Buffer.concat([header, Buffer.alloc(samples * 2)]));
  return path;
}

/**
 * Drops a file from disk onto a drop zone the way Finder does. The file goes through a file
 * input first so that it is backed by the real file, which is what gives it a path.
 */
async function dropFile(zoneTestId: string, path: string): Promise<void> {
  await page.evaluate(() => {
    document.getElementById('e2e-file-input')?.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'e2e-file-input';
    input.hidden = true;
    document.body.append(input);
  });
  await page.setInputFiles('#e2e-file-input', path);
  await page.evaluate((testId) => {
    const input = document.getElementById('e2e-file-input') as HTMLInputElement;
    const file = input.files?.[0];
    const zone = document.querySelector(`[data-testid="${testId}"]`);
    if (!file || !zone) throw new Error('Nothing to drop, or nowhere to drop it');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      zone.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    }
  }, zoneTestId);
}

async function saveScreenshot(name: string): Promise<void> {
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: join(screenshotDir, `${name}.png`), animations: 'disabled' });
}

// ── Every step and variant ──────────────────────────────────────────────────

const FIXTURES: [step: number, variant: string, id: string][] = [
  [1, 'ask', 'microphone'],
  [1, 'denied', 'microphone'],
  [1, 'granted', 'microphone'],
  [1, 'starting', 'microphone'],
  [1, 'no-devices', 'microphone'],
  [1, 'error', 'microphone'],
  [2, 'video', 'mode'],
  [2, 'audio', 'mode'],
  [2, 'camera-ask', 'mode'],
  [2, 'camera-denied', 'mode'],
  [2, 'camera-starting', 'mode'],
  [2, 'camera-error', 'mode'],
  [2, 'no-camera', 'mode'],
  [3, 'choose', 'headphones'],
  [3, 'fixed', 'headphones'],
  [4, 'listening', 'mic-test'],
  [4, 'passed', 'mic-test'],
  [4, 'error', 'mic-test'],
  [5, 'ready', 'headphone-test'],
  [6, 'on', 'monitoring'],
  [6, 'error', 'monitoring'],
  [7, 'both', 'hands'],
  [7, 'one', 'hands'],
  [7, 'none', 'hands'],
  [7, 'error', 'hands'],
  [8, 'none', 'backing'],
  [8, 'loading', 'backing'],
  [8, 'ready', 'backing'],
  [8, 'failed', 'backing'],
  [9, 'none', 'reference'],
  [9, 'analyzing', 'reference'],
  [9, 'ready', 'reference'],
  [9, 'failed', 'reference'],
  [10, 'analyzing', 'melody'],
  [10, 'loading', 'melody'],
  [10, 'ready', 'melody'],
  [10, 'key-only', 'melody'],
  [10, 'failed', 'melody'],
  [11, 'video', 'ready'],
  [11, 'audio', 'ready'],
];

test('every step and variant fits the card without scrolling', async () => {
  for (const [step, variant, id] of FIXTURES) {
    await openFixture(step, variant);
    await expectStep(id);
    // Let the live meters and the stand-in camera picture settle before the screenshot.
    await page.waitForTimeout(300);
    const overflow = await stepBody().evaluate((body) => body.scrollHeight - body.clientHeight);
    expect(overflow, `${id}/${variant} scrolls inside the card`).toBeLessThanOrEqual(1);
    await saveScreenshot(`${String(step).padStart(2, '0')}-${id}-${variant}`);
  }
});

// ── 1. Microphone ───────────────────────────────────────────────────────────

test('microphone: asks for permission, then opens the microphone quietly', async () => {
  await openFixture(1, 'ask');
  await expect(page.getByRole('heading', { name: 'Choose your microphone' })).toBeFocused();
  await expect(back()).toHaveCount(0);
  await expect(primary()).toHaveText('Allow microphone');

  await primary().click();
  expect(await callsTo('requestPermission')).toEqual([['microphone']]);
  expect(await callsTo('startAudio')).toEqual([]);

  // The singer allowed it: the wizard starts the audio with monitoring off (no headphones yet).
  await patchState({ permissions: { microphone: 'granted' } });
  await expect(page.getByTestId('wizard-microphone-select')).toBeVisible();
  await expect.poll(() => callsTo('startAudio')).toEqual([[]]);
  expect(await callsTo('updateSettings')).toEqual([[{ audio: { monitoringEnabled: false } }]]);
});

test('microphone: a refused permission shows the friendly message and a way to fix it', async () => {
  await openFixture(1, 'denied');
  await expect(page.getByTestId('wizard-microphone-blocked')).toContainText(
    FRIENDLY_ERROR_MESSAGES['microphone-permission-denied'],
  );
  await page.getByRole('button', { name: 'Open System Settings' }).click();
  expect(await callsTo('openPermissionSettings')).toEqual([['microphone']]);

  await page.getByRole('button', { name: 'Check again' }).click();
  expect(await callsTo('requestPermission')).toEqual([['microphone']]);
});

test('microphone: choosing a device, with System default first, and a live meter', async () => {
  await openFixture(1, 'granted');
  const select = page.getByTestId('wizard-microphone-select');
  await expect(select.locator('option')).toHaveText([
    'System default',
    'MacBook Pro Microphone',
    'Scarlett Solo USB',
  ]);

  await select.selectOption({ label: 'Scarlett Solo USB' });
  expect(await callsTo('selectMicrophone')).toEqual([['mic-usb']]);

  await patchState({ settings: { devices: { microphoneId: 'mic-usb' } } });
  await select.selectOption({ label: 'System default' });
  expect(await callsTo('selectMicrophone')).toEqual([['mic-usb'], [null]]);

  // The meter follows live.inputLevel.
  const meter = page.getByTestId('wizard-microphone-meter');
  await patchLive({ inputLevel: 0 });
  await expect.poll(() => meter.getAttribute('aria-valuenow')).toBe('0');
  await patchLive({ inputLevel: 0.5 });
  await expect
    .poll(async () => Number(await meter.getAttribute('aria-valuenow')))
    .toBeGreaterThan(50);
});

test('microphone: no microphone at all is a friendly empty state', async () => {
  await openFixture(1, 'no-devices');
  await expect(page.getByTestId('wizard-microphone-select')).toHaveCount(0);
  await expect(page.getByTestId('wizard-microphone-error')).toContainText(
    FRIENDLY_ERROR_MESSAGES['no-microphone'],
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  expect(await callsTo('startAudio')).toEqual([[]]);
});

// ── 2. Camera or Audio Only ─────────────────────────────────────────────────

test('mode: video shows a mirrored camera preview and a camera choice', async () => {
  await openFixture(2, 'video');
  await expect(page.getByRole('radio', { name: /Video/ })).toHaveAttribute('aria-checked', 'true');

  const video = page.getByTestId('wizard-camera-preview').locator('video');
  await expect(video).toBeVisible();
  const look = await video.evaluate((element) => {
    const style = getComputedStyle(element);
    return { transform: style.transform, objectFit: style.objectFit };
  });
  expect(look).toEqual({ transform: 'matrix(-1, 0, 0, 1, 0, 0)', objectFit: 'cover' });
  expect(await callsTo('attachPreview')).toEqual([['<VIDEO>']]);

  const select = page.getByTestId('wizard-camera-select');
  await expect(select.locator('option')).toHaveText([
    'System default',
    'FaceTime HD Camera',
    'Logitech StreamCam',
  ]);
  await select.selectOption({ label: 'Logitech StreamCam' });
  expect(await callsTo('selectCamera')).toEqual([['cam-usb']]);

  // Choosing Audio Only hides the preview, which hands the video element back.
  await page.getByRole('radio', { name: /Audio Only/ }).click();
  expect(await callsTo('setMode')).toEqual([['audio']]);
  await expect(page.getByTestId('wizard-camera-preview')).toHaveCount(0);
  expect(await callsTo('attachPreview')).toEqual([['<VIDEO>'], [null]]);
  await expectStep('mode', 'Step 2 of 9');
});

test('mode: the camera permission is asked for, then the camera starts', async () => {
  await openFixture(2, 'camera-ask');
  await expect(primary()).toHaveText('Allow camera');
  await primary().click();
  expect(await callsTo('requestPermission')).toEqual([['camera']]);
  expect(await callsTo('startCamera')).toEqual([]);

  await patchState({ permissions: { camera: 'granted' } });
  await expect.poll(() => callsTo('startCamera')).toEqual([[]]);
});

test('mode: a refused camera offers System Settings or Audio Only', async () => {
  await openFixture(2, 'camera-denied');
  await expect(page.getByTestId('wizard-camera-blocked')).toContainText(
    FRIENDLY_ERROR_MESSAGES['camera-permission-denied'],
  );
  await primary().click();
  expect(await callsTo('openPermissionSettings')).toEqual([['camera']]);
  await expect(secondary()).toHaveText('Use Audio Only');
  await secondary().click();
  expect(await callsTo('setMode')).toEqual([['audio']]);
});

test('mode: a camera error shows the friendly message and moves on in Audio Only', async () => {
  await openFixture(2, 'camera-error');
  await expect(page.getByTestId('wizard-camera-error')).toContainText(
    FRIENDLY_ERROR_MESSAGES['device-disconnected'],
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  expect(await callsTo('startCamera')).toEqual([[]]);

  await expect(primary()).toHaveText('Continue with Audio Only');
  await primary().click();
  expect(await callsTo('setMode')).toEqual([['audio']]);
  await expectStep('headphones', 'Step 3 of 9');
});

// ── 3. Headphones ───────────────────────────────────────────────────────────

test('headphones: choosing an output, with a reminder to wear headphones', async () => {
  await openFixture(3, 'choose');
  await expect(page.getByText('Use headphones.')).toBeVisible();
  const select = page.getByTestId('wizard-output-select');
  await expect(select.locator('option')).toHaveText([
    'System default',
    'MacBook Pro Speakers',
    'AirPods Pro',
  ]);
  await expect(select).toHaveValue('out-headphones');
  await select.selectOption({ label: 'System default' });
  await patchState({ settings: { devices: { outputId: null } } });
  await select.selectOption({ label: 'MacBook Pro Speakers' });
  expect(await callsTo('selectOutput')).toEqual([[null], ['out-speakers']]);
});

test('headphones: where outputs cannot be chosen, the current output is explained', async () => {
  await openFixture(3, 'fixed');
  await expect(page.getByTestId('wizard-output-select')).toHaveCount(0);
  await expect(page.getByTestId('wizard-output-fixed')).toContainText(
    'your computer’s current output',
  );
});

// ── 4. Microphone test ──────────────────────────────────────────────────────

test('mic test: says "We can hear you" once the level has clearly moved', async () => {
  await openFixture(4, 'listening');
  await expect(page.getByText('Say or sing something.')).toBeVisible();
  const status = page.getByTestId('wizard-mic-test-status');
  await expect(status).toHaveText('Listening…');
  await expect(primary()).toBeEnabled();

  // A single click of noise is not a voice.
  await patchLive({ inputLevel: 0.3 });
  await page.waitForTimeout(60);
  await patchLive({ inputLevel: 0.003 });
  await page.waitForTimeout(800);
  await expect(status).toHaveText('Listening…');

  await patchLive({ inputLevel: 0.3 });
  await expect(status).toHaveText('We can hear you');
  await expect(status).toHaveAttribute('aria-live', 'polite');
});

test('mic test: never blocks Continue, even when the engine has failed', async () => {
  await openFixture(4, 'error');
  await expect(page.getByTestId('wizard-mic-test-error')).toContainText(
    FRIENDLY_ERROR_MESSAGES['device-disconnected'],
  );
  await primary().click();
  await expectStep('headphone-test');
});

// ── 5. Headphone test ───────────────────────────────────────────────────────

test('headphone test: play, then "I heard it" moves on', async () => {
  await openFixture(5);
  await expect(primary()).toHaveText('Play test sound');
  await primary().click();
  expect(await callsTo('playTestSound')).toEqual([[]]);

  await expect(page.getByTestId('wizard-test-sound-prompt')).toHaveText(
    'Did you hear the chime in your headphones?',
  );
  await expect(primary()).toHaveText('I heard it');
  await primary().click();
  await expectStep('monitoring');
});

test('headphone test: "I didn\'t hear anything" gives tips and a way back', async () => {
  await openFixture(5);
  await primary().click();
  await secondary().click();
  await expect(page.getByTestId('wizard-test-sound-tips')).toContainText('volume');
  await expect(page.getByTestId('wizard-test-sound-tips')).toContainText('headphones');

  await page.getByTestId('wizard-play-again').click();
  expect(await callsTo('playTestSound')).toEqual([[], []]);

  await page.getByTestId('wizard-change-headphones').click();
  await expectStep('headphones');
});

// ── 6. Hear yourself ────────────────────────────────────────────────────────

test('monitoring: turns live monitoring on and lends the echo to a slider', async () => {
  await openFixture(6, 'on');
  await expect(
    page.getByText('Sing a few notes: you should hear yourself in your headphones.'),
  ).toBeVisible();
  expect(await allCalls()).toEqual([
    ['updateSettings', { audio: { monitoringEnabled: true } }],
    ['setControlSource', 'echo', 'manual'],
  ]);

  const toggle = page.getByTestId('wizard-monitoring-toggle');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  const slider = page.getByTestId('wizard-echo-slider');
  await expect(slider).toHaveAttribute('aria-valuenow', '0.2');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  const [control, echo] = (await callsTo('setManualControl')).at(-1) ?? [];
  expect(control).toBe('echo');
  expect(echo).toBeCloseTo(0.21, 6);

  await toggle.click();
  expect((await callsTo('updateSettings')).at(-1)).toEqual([
    { audio: { monitoringEnabled: false } },
  ]);

  // Leaving puts the echo back exactly as it was before the step.
  await primary().click();
  await expectStep('hands');
  const restored = (await allCalls()).filter(
    ([name]) => name === 'setControlSource' || name === 'setManualControl',
  );
  expect(restored.slice(-2)).toEqual([
    ['setControlSource', 'echo', 'gesture'],
    ['setManualControl', 'echo', 0.2],
  ]);
});

test('monitoring: an engine error shows the friendly message', async () => {
  await openFixture(6, 'error');
  await expect(page.getByTestId('wizard-monitoring-error')).toContainText(
    FRIENDLY_ERROR_MESSAGES['audio-engine-failed'],
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  expect(await callsTo('startAudio')).toEqual([[]]);
});

// ── 7. Hands ────────────────────────────────────────────────────────────────

test('hands: confirms each hand as it is seen and follows the controls', async () => {
  await openFixture(7, 'none');
  await expect(page.getByTestId('wizard-hand-instructions').locator('li')).toHaveText([
    /Autotune\s*Open and close your right hand/,
    /Volume\s*Move your right hand closer or farther/,
    /Echo\s*Open and close your left hand/,
  ]);
  const left = page.getByTestId('wizard-hand-left');
  const right = page.getByTestId('wizard-hand-right');
  const seen = page.getByTestId('wizard-hands-seen');
  await expect(left).toHaveAttribute('data-seen', 'false');
  await expect(right).toHaveAttribute('data-seen', 'false');
  await expect(seen).toHaveText('No hands in view');

  await patchLive({
    gesture: { right: { status: 'tracking' } },
    controls: { autotune: 0.8, echo: 0, volume: 0.5 },
  });
  await expect(right).toHaveAttribute('data-seen', 'true');
  await expect(left).toHaveAttribute('data-seen', 'false');
  await expect(seen).toHaveText('Right hand in view');
  await expect(page.getByTestId('wizard-indicator-autotune')).toContainText('80%');

  await patchLive({ gesture: { left: { status: 'tracking' } }, controls: { echo: 0.9 } });
  await expect(left).toHaveAttribute('data-seen', 'true');
  await expect(seen).toHaveText('Both hands in view');
  await expect(page.getByTestId('wizard-indicator-echo')).toContainText('90%');
});

test('hands: setting the resting distance reports success', async () => {
  await openFixture(7, 'both');
  const status = page.getByTestId('wizard-calibrate-status');
  await expect(status).toContainText('comfortable distance');
  await page.getByTestId('wizard-calibrate').click();
  expect(await callsTo('calibrateHandDistance')).toEqual([[]]);
  await expect(status).toHaveText('Saved. That distance is now your normal volume.');
});

test('hands: setting the resting distance with no hand in view says so', async () => {
  await openFixture(7, 'none');
  await page.getByTestId('wizard-calibrate').click();
  await expect(page.getByTestId('wizard-calibrate-status')).toHaveText(
    'We could not see your right hand. Hold it up and try again.',
  );
});

test('hands: a tracking error is explained and the singer can carry on', async () => {
  await openFixture(7, 'error');
  await expect(page.getByTestId('wizard-hands-problem')).toContainText(
    FRIENDLY_ERROR_MESSAGES['hand-tracking-failed'],
  );
  await expect(page.getByTestId('wizard-calibrate')).toHaveCount(0);
  await primary().click();
  await expectStep('backing');
});

test('hands: the step goes away if the app falls back to Audio Only', async () => {
  await openFixture(7, 'both');
  await patchState({ settings: { mode: 'audio' } });
  await expectStep('backing', 'Step 7 of 9');
});

// ── 8. Backing track ────────────────────────────────────────────────────────

test('backing: choose, drop, or skip', async () => {
  await openFixture(8, 'none');
  await expect(
    page.getByText('This is the instrumental you sing over. It plays in your headphones'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Choose Backing track' }).click();
  await primary().click();
  expect(await callsTo('chooseBackingTrack')).toEqual([[], []]);

  const song = writeSong('Backing.wav');
  await dropFile('wizard-backing-zone', song);
  expect(await callsTo('loadBackingTrack')).toEqual([[song]]);

  await expect(secondary()).toHaveText('Skip: sing a cappella');
  await secondary().click();
  await expectStep('reference');
});

test('backing: a file that is not a song is turned away kindly', async () => {
  await openFixture(8, 'none');
  const notes = join(songDir, 'Notes.txt');
  writeFileSync(notes, 'la la la');
  await dropFile('wizard-backing-zone', notes);
  await expect(page.getByTestId('wizard-backing-zone')).toContainText('is not a song file');
  expect(await callsTo('loadBackingTrack')).toEqual([]);
});

test('backing: loading, loaded and failed', async () => {
  await openFixture(8, 'loading');
  await expect(page.getByTestId('wizard-backing-zone')).toContainText('Opening…');

  await openFixture(8, 'ready');
  const zone = page.getByTestId('wizard-backing-zone');
  await expect(zone).toContainText('Midnight City (Instrumental).mp3');
  await expect(zone).toContainText('Backing track · 4:03');
  await expect(primary()).toHaveText('Continue');
  await page.getByRole('button', { name: 'Remove Backing track' }).click();
  expect(await callsTo('clearBackingTrack')).toEqual([[]]);

  await openFixture(8, 'failed');
  await expect(page.getByTestId('wizard-backing-zone')).toContainText(
    FRIENDLY_ERROR_MESSAGES['unsupported-audio-file'],
  );
  await expect(primary()).toHaveText('Choose another file');
  // Skipping drops the failed file so it does not follow the singer into the studio.
  await secondary().click();
  expect(await callsTo('clearBackingTrack')).toEqual([[]]);
  await expectStep('reference');
});

// ── 9. Original song ────────────────────────────────────────────────────────

test('reference: explains it is never recorded; choose, drop, remove or skip', async () => {
  await openFixture(9, 'none');
  await expect(
    page.getByText('It is never part of your recording.', { exact: false }),
  ).toBeVisible();

  await primary().click();
  expect(await callsTo('chooseReferenceSong')).toEqual([[]]);

  const song = writeSong('Original.wav');
  await dropFile('wizard-reference-zone', song);
  expect(await callsTo('loadReferenceSong')).toEqual([[song]]);

  await expect(secondary()).toHaveText('Skip');
  await secondary().click();
  // No original song: the melody step does not apply.
  await expectStep('ready', 'Step 10 of 10');

  await openFixture(9, 'ready');
  await page.getByRole('button', { name: 'Remove Original song' }).click();
  expect(await callsTo('clearReferenceSong')).toEqual([[]]);
});

test('reference: progress and failure show in the drop zone', async () => {
  await openFixture(9, 'analyzing');
  await expect(page.getByTestId('wizard-reference-zone')).toContainText(
    'Analyzing reference vocal… 40%',
  );
  await openFixture(9, 'failed');
  await expect(page.getByTestId('wizard-reference-zone')).toContainText(
    FRIENDLY_ERROR_MESSAGES['analysis-failed'],
  );
});

// ── 10. Learning the melody ─────────────────────────────────────────────────

test('melody: progress, ready, key only and failed', async () => {
  await openFixture(10, 'analyzing');
  const progress = page.getByTestId('wizard-melody-progress');
  await expect(page.getByTestId('wizard-melody')).toContainText('Analyzing reference vocal…');
  await expect(progress).toHaveAttribute('role', 'progressbar');
  await expect(progress).toHaveAttribute('aria-valuenow', '40');
  // Analysis carries on in the background; the singer need not wait.
  await expect(primary()).toBeEnabled();
  await expect(primary()).toHaveText('Continue');

  await patchState({
    reference: { status: 'ready', progress: 1, keyLabel: 'A minor', melodyUsable: true },
  });
  await expect(page.getByTestId('wizard-melody-status')).toHaveText('Reference melody ready');
  await expect(page.getByTestId('wizard-melody-key')).toHaveText('Song key: A minor');
  await expect(page.getByTestId('wizard-melody-key-only')).toHaveCount(0);

  await openFixture(10, 'key-only');
  await expect(page.getByTestId('wizard-melody-key-only')).toContainText(
    'autotune will follow the song’s key',
  );

  await openFixture(10, 'failed');
  await expect(page.getByTestId('wizard-melody-failed')).toContainText(
    FRIENDLY_ERROR_MESSAGES['analysis-failed'],
  );
  await primary().click();
  await expectStep('ready');
});

// ── 11. Ready ───────────────────────────────────────────────────────────────

test('ready: summarises the setup and enters the studio', async () => {
  await openFixture(11, 'video');
  const summary = page.getByTestId('wizard-summary');
  for (const value of [
    'Scarlett Solo USB',
    'Video with hand gestures',
    'FaceTime HD Camera',
    'AirPods Pro',
    'Midnight City (Instrumental).mp3',
    'Midnight City.m4a',
  ]) {
    await expect(summary).toContainText(value);
  }
  await expect(primary()).toHaveText('Enter Studio');
  await primary().click();
  expect(await callsTo('completeOnboarding')).toEqual([[]]);

  await openFixture(11, 'audio');
  await expect(summary).toContainText('Audio only with sliders');
  await expect(summary.locator('[data-row="camera"]')).toHaveCount(0);
});

// ── Whole sequence ──────────────────────────────────────────────────────────

test('walks every step in video mode, then all the way back', async () => {
  await openFixture(1, 'granted');
  const forward: [id: string, how: 'primary' | 'secondary' | 'test-sound'][] = [
    ['microphone', 'primary'],
    ['mode', 'primary'],
    ['headphones', 'primary'],
    ['mic-test', 'primary'],
    ['headphone-test', 'test-sound'],
    ['monitoring', 'primary'],
    ['hands', 'primary'],
    ['backing', 'secondary'],
    ['reference', 'secondary'],
  ];
  for (const [index, [id, how]] of forward.entries()) {
    await expectStep(id, `Step ${index + 1} of 10`);
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    if (how === 'test-sound') await primary().click();
    await (how === 'secondary' ? secondary() : primary()).click();
  }
  await expectStep('ready', 'Step 10 of 10');
  await primary().click();
  expect(await callsTo('completeOnboarding')).toEqual([[]]);

  const backward = ['reference', 'backing', 'hands', 'monitoring', 'headphone-test'];
  backward.push('mic-test', 'headphones', 'mode', 'microphone');
  for (const id of backward) {
    await back().click();
    await expectStep(id);
  }
  await expect(back()).toHaveCount(0);
});

test('walks every step in Audio Only mode, with an original song added on the way', async () => {
  await openFixture(1, 'granted');
  await primary().click();
  await expectStep('mode', 'Step 2 of 10');
  await page.getByRole('radio', { name: /Audio Only/ }).click();
  await expectStep('mode', 'Step 2 of 9');
  await primary().click();

  const steps = ['headphones', 'mic-test', 'headphone-test', 'monitoring', 'backing'];
  for (const [index, id] of steps.entries()) {
    await expectStep(id, `Step ${index + 3} of 9`);
    if (id === 'headphone-test') await primary().click();
    await (id === 'backing' ? secondary() : primary()).click();
  }

  // The singer adds the original song; the app starts analysing it.
  await expectStep('reference', 'Step 8 of 9');
  await patchState({
    reference: {
      status: 'analyzing',
      progress: 0.1,
      file: { name: 'Song.m4a', path: '/tmp/Song.m4a', durationSec: 200 },
    },
  });
  await expectStep('reference', 'Step 8 of 10');
  await expect(primary()).toHaveText('Continue');
  await primary().click();
  await expectStep('melody', 'Step 9 of 10');
  await primary().click();
  await expectStep('ready', 'Step 10 of 10');
  await expect(page.getByTestId('wizard-summary')).toContainText('Song.m4a · still learning');

  await back().click();
  await expectStep('melody');
  await back().click();
  await back().click();
  // Hands do not apply in Audio Only: back from the backing step is "Hear yourself".
  await back().click();
  await expectStep('monitoring');
});

// ── Keyboard ────────────────────────────────────────────────────────────────

test('keyboard: Enter is the primary action, Escape changes nothing, focus follows', async () => {
  await openFixture(1, 'granted');
  await expect(page.getByRole('heading', { name: 'Choose your microphone' })).toBeFocused();
  await expect(page.getByTestId('wizard-shortcut')).toContainText('Continue');

  await page.keyboard.press('Enter');
  await expectStep('mode');
  await expect(page.getByRole('heading', { name: 'Camera or Audio Only' })).toBeFocused();

  const before = await allCalls();
  await page.keyboard.press('Escape');
  await expectStep('mode');
  expect(await allCalls()).toEqual(before);

  // Tab reaches the choice; arrow keys move it like any radio group.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: /Video/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  expect((await callsTo('setMode')).at(-1)).toEqual(['audio']);
  await expect(page.getByRole('radio', { name: /Audio Only/ })).toBeFocused();

  // Enter on a control does that control's job, not the step's: here Back goes back.
  await page.keyboard.press('Tab');
  await expect(back()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(primary()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expectStep('microphone');
});

test('keyboard: Enter plays the test sound on the headphone test', async () => {
  await openFixture(5);
  await page.keyboard.press('Enter');
  expect(await callsTo('playTestSound')).toEqual([[]]);
  await expect(primary()).toHaveText('I heard it');
  await page.keyboard.press('Enter');
  await expectStep('monitoring');
});
