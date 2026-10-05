// Drives the studio screen against fixed state (src/renderer/src/dev/studioPreview.tsx): what
// each state shows, which action every control and shortcut calls, and screenshots of every
// state at two window sizes for visual review (test-results/studio/).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/app';

const screenshotDir = resolve(__dirname, '../../test-results/studio');

interface ActionCall {
  name: string;
  args: unknown[];
}

/** The parts of window.__staticStudio the tests use. */
interface PreviewStudio {
  calls: ActionCall[];
  store: {
    getState(): Record<string, unknown>;
    setState(patch: Record<string, unknown>): void;
  };
  live: {
    controls: Record<string, number>;
    controlStatus: Record<string, string>;
    recordingElapsedSec: number;
  };
  animation: { running: boolean };
}

type PreviewWindow = Window & { __staticStudio: PreviewStudio };

const SIZES = [
  { name: '1280', width: 1280, height: 800 },
  { name: '1920', width: 1920, height: 1080 },
] as const;

let launched: LaunchedApp;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  launched = await launchApp({ page: 'studio-preview.html' });
  page = launched.page;
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.afterAll(async () => {
  await launched?.close();
});

async function openFixture(id: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next;
  }, `state=${id}`);
  await page.reload();
  await expect(page.locator(`[data-testid="studio-preview"][data-fixture="${id}"]`)).toBeVisible();
  await expect(page.getByTestId('studio-screen')).toBeVisible();
  // Keep the pointer off the controls so no hover state leaks into a screenshot.
  await page.mouse.move(640, 400);
}

async function calls(): Promise<ActionCall[]> {
  const all = await page.evaluate(() => (window as unknown as PreviewWindow).__staticStudio.calls);
  // Mounting hands over the <video>; that is not something a control did.
  return all.filter((call) => call.name !== 'attachPreview');
}

async function clearCalls(): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as PreviewWindow).__staticStudio.calls.length = 0;
  });
}

async function expectLastCall(name: string, args?: unknown[]): Promise<void> {
  await expect
    .poll(async () => {
      const last = (await calls()).at(-1);
      return last && { name: last.name, ...(args ? { args: last.args } : {}) };
    })
    .toEqual({ name, ...(args ? { args } : {}) });
}

async function holdLiveStill(): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as PreviewWindow).__staticStudio.animation.running = false;
  });
}

async function setState(patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((next) => {
    (window as unknown as PreviewWindow).__staticStudio.store.setState(next);
  }, patch);
}

async function saveScreenshots(name: string): Promise<void> {
  for (const size of SIZES) {
    mkdirSync(join(screenshotDir, size.name), { recursive: true });
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: join(screenshotDir, size.name, `${name}.png`),
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

function radio(group: Locator, name: string): Locator {
  return group.getByRole('radio', { name, exact: true });
}

/** What every fixture must show, checked before its screenshots are taken. */
const STATE_CHECKS: Record<string, () => Promise<void>> = {
  idle: async () => {
    await expect(page.getByTestId('backing-chip')).toHaveText('Add backing track');
    await expect(page.getByTestId('reference-chip')).toHaveText('Add original song');
    await expect(page.getByTestId('camera-preview')).toBeVisible();
    await expect(page.getByTestId('record-button')).toBeEnabled();
    await expect(page.getByTestId('headphones-banner')).toBeVisible();
    for (const id of ['autotune', 'echo', 'volume']) {
      await expect(page.getByTestId(`indicator-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId('edge-left').getByTestId('indicator-echo')).toBeVisible();
    await expect(page.getByTestId('edge-right').getByTestId('indicator-autotune')).toBeVisible();
    await expect(page.getByTestId('edge-right').getByTestId('indicator-volume')).toBeVisible();
    await expect(page.getByTestId('take-status')).toHaveCount(0);
    await expect(page.getByTestId('landmarks-overlay')).toHaveCount(0);
  },
  'idle-songs': async () => {
    await expect(page.getByTestId('backing-chip')).toContainText(
      'Midnight City (Instrumental).mp3',
    );
    await expect(page.getByTestId('reference-chip')).toContainText('Reference melody ready');
    await expect(page.getByTestId('reference-chip')).toContainText('A minor');
    await expect(page.getByTestId('backing-preview-button')).toBeVisible();
  },
  audio: async () => {
    await expect(page.getByTestId('audio-stage')).toBeVisible();
    await expect(page.getByTestId('camera-preview')).toHaveCount(0);
    await expect(page.getByTestId('indicator-autotune')).toHaveCount(0);
    await expect(page.getByTestId('controls-panel')).toHaveAttribute('data-docked', 'true');
    await expect(page.getByTestId('controls-button')).toHaveCount(0);
    await expect(page.getByTestId('control-rows-note')).toContainText('Audio Only');
    await expect(page.getByTestId('keyboard-hints')).toBeVisible();
    await expect(radio(page.getByTestId('control-row-echo'), 'Gesture')).toBeDisabled();
  },
  countdown: async () => {
    await expect(page.getByTestId('countdown')).toHaveText('3');
    await expect(page.getByTestId('countdown-cancel')).toBeVisible();
    await expect(radio(page.getByTestId('mode-switch'), 'Audio Only')).toBeDisabled();
  },
  recording: async () => {
    await expect(page.getByTestId('record-status-label')).toHaveText('Recording');
    await expect(page.getByTestId('record-timer')).toHaveText(/^\d\d:\d\d$/);
    await expect(page.getByTestId('record-readout-autotune')).toHaveText(/^\d+%$/);
    await expect(page.getByTestId('pause-button')).toHaveAttribute('aria-label', 'Pause recording');
    await expect(page.getByTestId('headphones-banner')).toHaveCount(0);
  },
  paused: async () => {
    await expect(page.getByTestId('record-status-label')).toHaveText('Paused');
    await expect(page.getByTestId('record-timer')).toHaveText('00:47');
    await expect(page.getByTestId('pause-button')).toHaveAttribute(
      'aria-label',
      'Resume recording',
    );
  },
  finishing: async () => {
    await expect(page.getByTestId('record-finishing')).toContainText('Finishing your take');
  },
  review: async () => {
    await expect(page.getByTestId('export-dialog')).toHaveAttribute('data-view', 'review');
    await expect(page.getByTestId('export-take-length')).toContainText('1 min 24 sec');
    await expect(page.getByTestId('export-save')).toHaveText('Save Video…');
  },
  'review-error': async () => {
    await expect(page.getByTestId('export-error')).toContainText('could not be saved');
    await expect(page.getByTestId('export-save')).toHaveText('Try Again');
  },
  exporting: async () => {
    await expect(page.getByTestId('export-dialog')).toHaveAttribute('data-view', 'exporting');
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^45/);
    await expect(page.getByTestId('export-dialog')).toContainText('Creating the video');
  },
  saved: async () => {
    await expect(page.getByTestId('export-dialog')).toContainText('Saved successfully');
    await expect(page.getByTestId('export-file-name')).toHaveText(
      'Holographic-Studio-Take-2026-10-05-1432.mp4',
    );
  },
  'mic-denied': async () => {
    const card = page.getByTestId('problem-card');
    await expect(card).toHaveAttribute('data-source', 'microphone');
    await expect(card).toContainText('Microphone access is off');
    await expect(page.getByTestId('record-button')).toBeDisabled();
  },
  'camera-denied': async () => {
    await expect(page.getByTestId('problem-card')).toContainText('Camera access is off');
    await expect(page.getByTestId('problem-action-switch-to-audio')).toBeVisible();
  },
  'camera-error': async () => {
    await expect(page.getByTestId('problem-card')).toContainText('No camera found');
    await expect(page.getByTestId('problem-action-open-system-settings')).toHaveCount(0);
  },
  'tracking-error': async () => {
    await expect(page.getByTestId('tracking-note')).toBeVisible();
    await expect(page.getByTestId('problem-card')).toHaveCount(0);
    await expect(page.getByTestId('record-button')).toBeEnabled();
  },
  analyzing: async () => {
    await expect(page.getByTestId('reference-chip')).toContainText('Analyzing reference vocal');
    await expect(page.getByTestId('reference-chip')).toContainText('42%');
  },
  'key-only': async () => {
    await expect(page.getByTestId('reference-chip')).toContainText('Following the song’s key');
  },
  'reference-failed': async () => {
    await expect(page.getByTestId('reference-chip')).toHaveAttribute('data-kind', 'failed');
  },
  'hands-lost': async () => {
    await expect(page.getByTestId('hands-hint')).toHaveText(
      'Show your hands to control the effects',
      { timeout: 5000 },
    );
    await expect(page.getByTestId('indicator-autotune')).toHaveAttribute('data-status', 'lost');
  },
  notice: async () => {
    await expect(page.getByTestId('toast')).toContainText('headphones were disconnected');
  },
  controls: async () => {
    await expect(page.getByTestId('controls-panel')).toBeVisible();
    // The panel takes the bottom-right corner; the right-hand indicators make way.
    await expect(page.getByTestId('indicator-autotune')).toBeHidden();
    await expect(page.getByTestId('indicator-echo')).toBeVisible();
    await expect(page.getByTestId('controls-button')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('keyboard-hints')).toBeVisible();
  },
  settings: async () => {
    const sheet = page.getByTestId('settings-sheet');
    await expect(sheet).toBeVisible();
    for (const group of ['devices', 'video', 'sound', 'hand-control', 'recording', 'advanced']) {
      await expect(sheet.getByTestId(`settings-${group}`)).toBeAttached();
    }
  },
  landmarks: async () => {
    await expect(page.getByTestId('landmarks-overlay')).toBeVisible();
  },
};

test('every state shows its key content (screenshots in test-results/studio)', async () => {
  for (const [id, check] of Object.entries(STATE_CHECKS)) {
    await openFixture(id);
    await check();
    await page.waitForTimeout(300);
    await saveScreenshots(id);
  }

  // The settings sheet scrolls; record its lower groups and the Advanced section too.
  await openFixture('settings');
  await page.getByTestId('settings-hand-control').scrollIntoViewIfNeeded();
  await saveScreenshots('settings-hand-control');
  await page.getByTestId('settings-advanced-toggle').click();
  await page.getByTestId('settings-run-setup').scrollIntoViewIfNeeded();
  await page.mouse.move(640, 400);
  await saveScreenshots('settings-advanced');
});

test('top bar: song chips, preview, mode and settings call their actions', async () => {
  await openFixture('idle');
  await clearCalls();
  await page.getByTestId('backing-chip').click();
  await expectLastCall('chooseBackingTrack');
  await page.getByTestId('reference-chip').click();
  await expectLastCall('chooseReferenceSong');

  await openFixture('idle-songs');
  await clearCalls();
  await page.getByTestId('backing-preview-button').click();
  await expectLastCall('togglePreviewPlayback');
  await setState({ previewPlaying: true });
  await expect(page.getByTestId('backing-preview-button')).toHaveAttribute(
    'aria-label',
    'Stop preview',
  );
  await page.getByRole('button', { name: 'Remove backing track' }).click();
  await expectLastCall('clearBackingTrack');
  await page.getByRole('button', { name: 'Remove original song' }).click();
  await expectLastCall('clearReferenceSong');

  await radio(page.getByTestId('mode-switch'), 'Audio Only').click();
  await expectLastCall('setMode', ['audio']);
  await expect(page.getByTestId('audio-stage')).toBeVisible();
  await radio(page.getByTestId('mode-switch'), 'Video').click();
  await expectLastCall('setMode', ['video']);

  await page.getByTestId('studio-settings-button').click();
  await expect(page.getByTestId('settings-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-sheet')).toHaveCount(0);

  // During a take the songs cannot change and the preview button is gone.
  await openFixture('recording');
  await expect(page.getByTestId('backing-preview-button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove backing track' })).toHaveCount(0);
  await expect(radio(page.getByTestId('mode-switch'), 'Video')).toBeDisabled();
});

test('record bar: record, countdown cancel, pause, stop and discard', async () => {
  await openFixture('idle-songs');
  await clearCalls();
  await page.getByTestId('record-button').click();
  await expectLastCall('startRecording');

  await openFixture('countdown');
  await clearCalls();
  await page.getByTestId('countdown-cancel').click();
  await expectLastCall('discardTake');
  await clearCalls();
  await expect(page.getByTestId('record-button')).toHaveAttribute('aria-label', 'Cancel countdown');
  await page.getByTestId('record-button').click();
  await expectLastCall('discardTake');

  await openFixture('recording');
  await clearCalls();
  await page.getByTestId('pause-button').click();
  await expectLastCall('togglePause');
  await page.getByTestId('record-button').click();
  await expectLastCall('stopRecording');

  await clearCalls();
  await page.getByTestId('discard-button').click();
  await expect(page.getByTestId('discard-prompt')).toBeVisible();
  await page.getByTestId('discard-keep').click();
  await expect(page.getByTestId('discard-prompt')).toHaveCount(0);
  expect(await calls()).toEqual([]);
  await page.getByTestId('discard-button').click();
  await saveScreenshots('recording-discard-prompt');
  await page.getByTestId('discard-confirm').click();
  await expectLastCall('discardTake');
});

test('controls panel: source switches and sliders', async () => {
  await openFixture('idle-songs');
  await clearCalls();
  await page.getByTestId('controls-button').click();
  const panel = page.getByTestId('controls-panel');
  await expect(panel).toBeVisible();

  await radio(page.getByTestId('control-row-echo'), 'Manual').click();
  await expectLastCall('setControlSource', ['echo', 'manual']);
  await expect(page.getByTestId('control-row-echo')).toHaveAttribute('data-source', 'manual');

  await page.getByTestId('control-row-autotune').getByRole('slider').focus();
  await page.keyboard.press('ArrowRight');
  await expectLastCall('setManualControl', ['autotune', 0.51]);
  await expect(
    page.getByTestId('control-row-volume').getByRole('slider', { name: /Volume/ }),
  ).toHaveAttribute('aria-valuenow', /^(50|0\.5)$/);

  // Escape closes the floating panel; the button opens and closes it too.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.getByTestId('controls-button').click();
  await expect(panel).toBeVisible();
  await page.getByTestId('controls-button').click();
  await expect(panel).toHaveCount(0);

  // With hand control off the Gesture option is unavailable, with a reason.
  await page.evaluate(() => {
    const studio = (window as unknown as PreviewWindow).__staticStudio;
    const settings = studio.store.getState().settings as {
      controls: Record<string, unknown>;
    };
    studio.store.setState({
      settings: { ...settings, controls: { ...settings.controls, handControlEnabled: false } },
    });
  });
  await page.getByTestId('controls-button').click();
  await expect(radio(page.getByTestId('control-row-autotune'), 'Gesture')).toBeDisabled();
  await expect(page.getByTestId('control-rows-note')).toContainText('turned off in Settings');
});

test('keyboard shortcuts call the right actions', async () => {
  await openFixture('idle-songs');
  await clearCalls();
  const shortcuts: [string, string, unknown[]][] = [
    ['ArrowUp', 'nudgeManualControl', ['autotune', 0.05]],
    ['ArrowDown', 'nudgeManualControl', ['autotune', -0.05]],
    ['ArrowRight', 'nudgeManualControl', ['echo', 0.05]],
    ['ArrowLeft', 'nudgeManualControl', ['echo', -0.05]],
    ['Equal', 'nudgeManualControl', ['volume', 0.05]],
    ['Minus', 'nudgeManualControl', ['volume', -0.05]],
    ['m', 'updateSettings', [{ audio: { monitoringEnabled: false } }]],
    ['Space', 'togglePreviewPlayback', []],
    ['r', 'startRecording', []],
  ];
  for (const [key, name, args] of shortcuts) {
    await page.keyboard.press(key);
    await expectLastCall(name, args);
  }
  expect((await calls()).length).toBe(shortcuts.length);

  await page.keyboard.press('Meta+Comma');
  await expect(page.getByTestId('settings-sheet')).toBeVisible();
  // With the sheet open, only Escape counts.
  await clearCalls();
  await page.keyboard.press('r');
  await page.keyboard.press('ArrowUp');
  expect(await calls()).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-sheet')).toHaveCount(0);

  await openFixture('recording');
  await clearCalls();
  await page.keyboard.press('Space');
  await expectLastCall('togglePause');
  await page.keyboard.press('r');
  await expectLastCall('stopRecording');

  await openFixture('countdown');
  await clearCalls();
  await page.keyboard.press('Escape');
  await expectLastCall('discardTake');
});

test('shortcuts are ignored while typing in a field', async () => {
  await openFixture('idle-songs');
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.dataset.testid = 'typing-field';
    field.style.cssText = 'position:fixed;top:200px;left:200px;z-index:9999';
    document.body.append(field);
  });
  await page.getByTestId('typing-field').focus();
  await clearCalls();
  for (const key of ['r', 'Space', 'm', 'ArrowUp', 'ArrowRight', 'Equal', 'Minus', 'Meta+Comma']) {
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(150);
  expect(await calls()).toEqual([]);
  await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
  // The field got every key: the arrows moved its caret, the characters were typed.
  await expect(page.getByTestId('typing-field')).toHaveValue('r=- m');
});

test('indicators, readouts and the timer follow the live readouts without state changes', async () => {
  await openFixture('recording');
  // Animated: the clock runs and the indicators move on their own.
  const firstTime = await page.getByTestId('record-timer').textContent();
  const firstAutotune = await page.getByTestId('indicator-autotune').textContent();
  await page.waitForTimeout(1300);
  expect(await page.getByTestId('record-timer').textContent()).not.toBe(firstTime);
  expect(await page.getByTestId('indicator-autotune').textContent()).not.toBe(firstAutotune);

  await holdLiveStill();
  await page.evaluate(() => {
    const { live } = (window as unknown as PreviewWindow).__staticStudio;
    live.recordingElapsedSec = 125.4;
    live.controls = { autotune: 0.73, echo: 0.12, volume: 0.5 };
    live.controlStatus = { autotune: 'holding', echo: 'gesture', volume: 'returning' };
  });
  await expect(page.getByTestId('record-timer')).toHaveText('02:05');
  await expect(page.getByTestId('indicator-autotune')).toContainText('73%');
  await expect(page.getByTestId('indicator-echo')).toContainText('12%');
  await expect(page.getByTestId('record-readout-autotune')).toHaveText('73%');
  await expect(page.getByTestId('record-readout-volume')).toHaveText('50%');
  await expect(page.getByTestId('indicator-autotune')).toHaveAttribute('data-status', 'holding');
  await expect(page.getByTestId('indicator-echo')).toHaveAttribute('data-status', 'gesture-live');
  await expect(page.getByTestId('indicator-volume')).toHaveAttribute('data-status', 'returning');

  // A control set to Manual reads as manual whatever the gesture layer last said.
  await openFixture('tracking-error');
  await expect(page.getByTestId('indicator-autotune')).toHaveAttribute('data-status', 'manual');
});

test('problem cards offer the right ways out', async () => {
  await openFixture('mic-denied');
  await clearCalls();
  await page.getByTestId('problem-action-open-system-settings').click();
  await expectLastCall('openPermissionSettings', ['microphone']);
  await page.getByTestId('problem-action-retry').click();
  await expectLastCall('startAudio');

  await openFixture('camera-denied');
  await clearCalls();
  await page.getByTestId('problem-action-open-system-settings').click();
  await expectLastCall('openPermissionSettings', ['camera']);
  await page.getByTestId('problem-action-retry').click();
  await expectLastCall('startCamera');
  await page.getByTestId('problem-action-switch-to-audio').click();
  await expectLastCall('setMode', ['audio']);
});

test('settings write through immediately', async () => {
  await openFixture('settings');
  await clearCalls();
  const sheet = page.getByTestId('settings-sheet');

  await sheet.getByTestId('settings-microphone').selectOption('mic-usb');
  await expectLastCall('selectMicrophone', ['mic-usb']);
  await sheet.getByTestId('settings-microphone').selectOption({ label: 'System default' });
  await expectLastCall('selectMicrophone', [null]);
  await sheet.getByTestId('settings-camera').selectOption('cam-built-in');
  await expectLastCall('selectCamera', ['cam-built-in']);
  await sheet.getByTestId('settings-output').selectOption('out-headphones');
  await expectLastCall('selectOutput', ['out-headphones']);

  await radio(sheet.getByTestId('settings-resolution'), '720p').click();
  await expectLastCall('updateSettings', [{ video: { resolution: '720p' } }]);

  await expect(sheet.getByTestId('settings-latency')).toHaveText(
    'You hear yourself about 24 ms after you sing.',
  );
  await sheet.getByTestId('settings-monitoring').click();
  await expectLastCall('updateSettings', [{ audio: { monitoringEnabled: false } }]);
  await sheet.getByTestId('settings-monitoring').click();
  await sheet.getByTestId('settings-monitor-volume').focus();
  await page.keyboard.press('ArrowLeft');
  await expectLastCall('updateSettings', [{ audio: { monitorVolume: 0.99 } }]);
  await sheet.getByTestId('settings-backing-volume').focus();
  await page.keyboard.press('ArrowLeft');
  await expectLastCall('updateSettings', [{ audio: { backingVolume: 0.79 } }]);
  await sheet.getByTestId('settings-mic-gain').focus();
  await page.keyboard.press('ArrowRight');
  await expectLastCall('updateSettings', [{ audio: { micGain: 1.05 } }]);
  await sheet.getByTestId('settings-reverb').click();
  await expectLastCall('updateSettings', [{ audio: { reverbEnabled: true } }]);

  await sheet.getByTestId('settings-calibrate').click();
  await expectLastCall('calibrateHandDistance');
  await sheet.getByTestId('settings-extra-gestures').click();
  await expectLastCall('updateSettings', [{ controls: { extraGesturesEnabled: true } }]);
  await radio(sheet.getByTestId('control-row-volume'), 'Manual').click();
  await expectLastCall('setControlSource', ['volume', 'manual']);
  await sheet.getByTestId('settings-hand-control-toggle').click();
  await expectLastCall('updateSettings', [{ controls: { handControlEnabled: false } }]);

  await sheet.getByTestId('settings-countdown').click();
  await expectLastCall('updateSettings', [{ recording: { countdownEnabled: false } }]);
  await sheet.getByTestId('settings-countdown').click();
  await sheet.getByTestId('settings-countdown-seconds').focus();
  await page.keyboard.press('ArrowRight');
  await expectLastCall('updateSettings', [{ recording: { countdownSec: 4 } }]);

  await expect(sheet.getByTestId('settings-vocal-offset')).toHaveCount(0);
  await sheet.getByTestId('settings-advanced-toggle').click();
  await sheet.getByTestId('settings-vocal-offset').focus();
  await page.keyboard.press('ArrowRight');
  await expectLastCall('updateSettings', [{ sync: { vocalOffsetMs: 5 } }]);
  await sheet.getByTestId('settings-video-offset').focus();
  await page.keyboard.press('ArrowLeft');
  await expectLastCall('updateSettings', [{ sync: { videoOffsetMs: -5 } }]);
  await sheet.getByTestId('settings-landmarks').click();
  await expectLastCall('updateSettings', [{ developer: { showLandmarks: true } }]);
  await expect(page.getByTestId('landmarks-overlay')).toBeAttached();
  await sheet.getByTestId('settings-run-setup').click();
  await expectLastCall('restartOnboarding');
  await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
});

test('export flow: save, discard, retry, cancel and what to do with the file', async () => {
  await openFixture('review');
  await clearCalls();
  await page.getByTestId('export-save').click();
  await expectLastCall('saveTake');
  await page.getByTestId('export-discard').click();
  await expect(page.getByTestId('export-dialog')).toHaveAttribute('data-view', 'confirm-discard');
  await saveScreenshots('review-confirm-discard');
  await page.getByTestId('export-keep').click();
  await expect(page.getByTestId('export-dialog')).toHaveAttribute('data-view', 'review');
  await page.getByTestId('export-discard').click();
  await page.getByTestId('export-discard-confirm').click();
  await expectLastCall('discardTake');

  await openFixture('review-error');
  await clearCalls();
  await page.getByTestId('export-save').click();
  await expectLastCall('saveTake');

  await openFixture('exporting');
  await clearCalls();
  await page.getByTestId('export-cancel').click();
  await expectLastCall('cancelExport');

  await openFixture('saved');
  await clearCalls();
  await page.getByTestId('export-open-file').click();
  await expectLastCall('openSavedFile');
  await page.getByTestId('export-show-in-folder').click();
  await expectLastCall('showSavedInFolder');
  await page.getByTestId('export-record-another').click();
  await expectLastCall('recordAnother');
});

test('notices become toasts and are reported when dismissed', async () => {
  await openFixture('notice');
  await clearCalls();
  await page.getByTestId('toast').getByRole('button', { name: 'Dismiss' }).click();
  await expectLastCall('dismissNotice', ['device-changed']);
});

test('dropping a file over the window offers it as the backing track', async () => {
  await openFixture('idle');
  const drag = async (type: string, name: string) => {
    await page.evaluate(
      ([eventType, fileName]) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['x'], fileName ?? 'file', { type: 'audio/mpeg' }));
        window.dispatchEvent(
          new DragEvent(eventType ?? 'drop', {
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      [type, name],
    );
  };

  await drag('dragenter', 'song.mp3');
  await expect(page.getByTestId('drop-overlay')).toBeVisible();
  await saveScreenshots('drop-overlay');
  await drag('drop', 'notes.txt');
  await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
  await expect(page.getByTestId('toast')).toContainText('is not an audio file');

  // A file made up in memory has no place on disk, which is refused politely too.
  await drag('dragenter', 'song.mp3');
  await drag('drop', 'song.mp3');
  await expect(page.getByTestId('toast').last()).toContainText('could not be read');
});
