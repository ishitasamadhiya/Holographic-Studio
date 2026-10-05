import { expect, test } from '@playwright/test';
import { launchApp } from './helpers/app';

test('the app launches and shows its window', async () => {
  const { app, page, close } = await launchApp();
  try {
    await expect(page.getByTestId('app-shell')).toBeVisible();
    expect(await page.title()).toBe('Holographic Studio');
    expect(app.windows()).toHaveLength(1);
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
  } finally {
    await close();
  }
});
