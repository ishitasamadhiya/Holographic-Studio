import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real Electron app with Chromium's synthetic camera and
// microphone, so they need no hardware and trigger no macOS permission prompts.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: './test-results',
});
