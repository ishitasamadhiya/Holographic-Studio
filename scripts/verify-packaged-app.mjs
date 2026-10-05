// Records and exports a short take inside the PACKAGED app (synthetic camera and microphone),
// to prove the bundle works on its own: worklets, hand-tracking assets and the unpacked FFmpeg.
// Usage: npm run dist && npm run verify:packaged
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import ffprobe from 'ffprobe-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultApp = path.join(
  root,
  `release/mac${process.arch === 'arm64' ? '-arm64' : ''}/Holographic Studio.app/Contents/MacOS/Holographic Studio`,
);

async function main() {
  const executablePath = process.argv[2] ?? defaultApp;
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Packaged app not found at ${executablePath}. Run: npm run dist`);
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-packaged-'));
  const outputPath = path.join(userDataDir, 'packaged-take.mp4');

  const app = await electron.launch({
    executablePath,
    env: { ...process.env, HOLO_E2E: '1', HOLO_USER_DATA_DIR: userDataDir },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(
      () => window.__holoTest && window.__holoTest.store.getState().phase !== 'loading',
      null,
      { timeout: 30_000 },
    );
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, outputPath);

    const recording = await page.evaluate(async () => {
      const studio = window.__holoTest;
      const state = () => studio.store.getState();
      const until = async (condition, what, timeoutMs = 30_000) => {
        const startedAt = Date.now();
        while (!condition()) {
          if (Date.now() - startedAt > timeoutMs) {
            throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(state().recording)}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      };
      studio.actions.updateSettings({ recording: { countdownEnabled: false } });
      studio.actions.completeOnboarding();
      await until(() => state().engine.status === 'running', 'the audio engine');
      await until(() => state().camera.status === 'running', 'the camera');
      await studio.actions.startRecording();
      await until(() => state().recording.status === 'recording', 'recording to start');
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await studio.actions.stopRecording();
      await until(() => state().recording.status === 'review', 'the take to be finished');
      await studio.actions.saveTake();
      await until(() => state().recording.status === 'saved', 'the export', 90_000);
      return state().recording;
    });

    const probe = JSON.parse(
      execFileSync(ffprobe.path, [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        '-show_format',
        outputPath,
      ]).toString(),
    );
    const streams = probe.streams.map((stream) => `${stream.codec_type}:${stream.codec_name}`);
    console.log(`saved: ${recording.savedPath}`);
    console.log(
      `streams: ${streams.join(', ')}  duration: ${Number(probe.format.duration).toFixed(2)} s`,
    );
    if (!streams.includes('video:h264') || !streams.includes('audio:aac')) {
      throw new Error('The exported file does not contain H.264 video and AAC audio.');
    }
    console.log('Packaged app OK');
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('Packaged app check FAILED:', error.message);
  process.exit(1);
});
