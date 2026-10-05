import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const projectRoot = resolve(__dirname, '../../..');

export interface LaunchOptions {
  /** Renderer page to open, e.g. 'gallery.html'. Defaults to the real app. */
  page?: string;
  /** .y4m / .mjpeg file used as the synthetic camera feed. */
  fakeVideo?: string;
  /** .wav file used as the synthetic microphone signal. */
  fakeAudio?: string;
  /** Reuse an existing data folder (to test what persists between launches). */
  userDataDir?: string;
  env?: Record<string, string>;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  close: () => Promise<void>;
}

/**
 * Chromium stops drawing frames while the display is asleep, which stalls the preview and
 * hand tracking and fails the tests that watch them. On macOS this wakes the display the same
 * way a key press would; it cannot help when the screen is locked.
 */
function wakeDisplay(): void {
  if (process.platform === 'darwin') spawnSync('caffeinate', ['-u', '-t', '1'], { timeout: 5000 });
}

/** Launches the built app (run `npx electron-vite build` first) with synthetic devices. */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  wakeDisplay();
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'holo-e2e-'));
  const outDir = process.env.HOLO_OUT_DIR ?? 'out';

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOLO_E2E: '1',
    HOLO_USER_DATA_DIR: userDataDir,
    ...options.env,
  };
  if (options.page) env.HOLO_E2E_PAGE = options.page;
  if (options.fakeVideo) env.HOLO_FAKE_VIDEO = options.fakeVideo;
  if (options.fakeAudio) env.HOLO_FAKE_AUDIO = options.fakeAudio;
  // electron-vite sets this in dev; a stale value would point the app at a dead dev server.
  delete env.ELECTRON_RENDERER_URL;

  const app = await electron.launch({
    args: [join(projectRoot, outDir, 'main/index.js')],
    cwd: projectRoot,
    env,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  return {
    app,
    page,
    userDataDir,
    close: async () => {
      await app.close();
      if (!options.userDataDir) rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}
