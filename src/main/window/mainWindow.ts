import { join } from 'node:path';
import { BrowserWindow, session, shell } from 'electron';
import { isE2E } from '../testEnvironment';
import { rendererUrl } from './appProtocol';

export function allowMediaPermissions(): void {
  // The only web content this app ever loads is its own UI, so camera and microphone
  // requests from it are always legitimate. macOS still shows its own system prompt.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'speaker-selection');
  });
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === 'media' || permission === 'speaker-selection',
  );
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#08080b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  window.once('ready-to-show', () => {
    // Tests must not steal keyboard focus from whatever the developer is doing.
    if (isE2E()) window.showInactive();
    else window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const page = process.env.HOLO_E2E_PAGE ?? 'index.html';
  const pageUrl = rendererUrl(page);

  // The window only ever shows the app itself. Without this, dropping a file outside a drop
  // zone would navigate to that file and replace the whole UI.
  const appOrigin = new URL(pageUrl).origin;
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== appOrigin) event.preventDefault();
  });

  void window.loadURL(pageUrl);
  return window;
}
