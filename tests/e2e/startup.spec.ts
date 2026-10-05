import { expect, test } from '@playwright/test';
import { launchApp } from './helpers/app';

test('a fresh profile opens one window showing the setup wizard', async () => {
  const { app, page, close } = await launchApp();
  try {
    await expect(page.getByTestId('wizard-screen')).toBeVisible();
    await expect(page.getByTestId('wizard-step')).toHaveAttribute('data-step', 'microphone');
    await expect(page.getByTestId('wizard-step-count')).toHaveText(/^Step 1 of \d+$/);
    expect(await page.title()).toBe('Holographic Studio');
    expect(app.windows()).toHaveLength(1);
    // The design system's global styles are loaded: the page is dark and fills the window.
    const look = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      scrolls: document.documentElement.scrollHeight > window.innerHeight,
    }));
    expect(look.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(look.scrolls).toBe(false);
  } finally {
    await close();
  }
});

test('synthetic camera and microphone are available to the app', async () => {
  const { page, close } = await launchApp();
  try {
    const tracks = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      const kinds = stream.getTracks().map((track) => track.kind);
      stream.getTracks().forEach((track) => track.stop());
      return kinds.sort();
    });
    expect(tracks).toEqual(['audio', 'video']);
    const devices = await page.evaluate(async () =>
      (await navigator.mediaDevices.enumerateDevices()).map((device) => device.kind),
    );
    expect(devices).toContain('audioinput');
    expect(devices).toContain('videoinput');
  } finally {
    await close();
  }
});
