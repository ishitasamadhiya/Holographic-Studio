import { app } from 'electron';

/**
 * End-to-end tests launch the app with HOLO_E2E=1. In that mode Chromium swaps the real
 * camera and microphone for synthetic ones (so no hardware or macOS permission is needed),
 * audio output is muted, and all app data goes to a throwaway folder.
 *
 * Optional overrides:
 *   HOLO_USER_DATA_DIR  where settings, caches and temporary takes are stored
 *   HOLO_FAKE_VIDEO     .y4m or .mjpeg file to use as the camera feed
 *   HOLO_FAKE_AUDIO     .wav file to use as the microphone signal
 *   HOLO_E2E_PAGE       renderer page to open instead of index.html (developer pages)
 */
export function isE2E(): boolean {
  return process.env.HOLO_E2E === '1';
}

export function applyTestEnvironment(): void {
  const userDataDir = process.env.HOLO_USER_DATA_DIR;
  if (userDataDir) app.setPath('userData', userDataDir);

  if (!isE2E()) return;

  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('mute-audio');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

  const fakeVideo = process.env.HOLO_FAKE_VIDEO;
  if (fakeVideo) app.commandLine.appendSwitch('use-file-for-fake-video-capture', fakeVideo);

  const fakeAudio = process.env.HOLO_FAKE_AUDIO;
  if (fakeAudio) app.commandLine.appendSwitch('use-file-for-fake-audio-capture', fakeAudio);
}
