import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real Electron app with Chromium's synthetic camera and
// microphone, so they need no hardware and trigger no macOS permission prompts.
// Each build folder gets its own scratch directory, so parallel runs (HOLO_OUT_DIR=...) do not
// wipe each other's traces or the screenshots that specs save under test-results/.
const scratchDir = `./test-results/.playwright-${process.env.HOLO_OUT_DIR ?? 'out'}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: scratchDir,
});
