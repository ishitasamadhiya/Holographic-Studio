import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, net, protocol, session, shell } from 'electron';
import { applyTestEnvironment, isE2E } from './testEnvironment';

const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://studio`;
const rendererRoot = join(__dirname, '../renderer');

// Must run before the app is ready: fake devices and the userData override are startup switches.
applyTestEnvironment();

// A privileged custom scheme gives the renderer a secure origin in production, which
// getUserMedia, WebAssembly streaming, workers and AudioWorklets all require.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
      corsEnabled: true,
    },
  },
]);

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const relativePath = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const filePath = normalize(join(rendererRoot, relativePath));
    if (!filePath.startsWith(rendererRoot + sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function rendererUrl(page: string): string {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  return devServer ? `${devServer}/${page}` : `${APP_ORIGIN}/${page}`;
}

function allowMediaPermissions(): void {
  // The only web content this app ever loads is its own UI, so camera and microphone
  // requests from it are always legitimate. macOS still shows its own system prompt.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'speaker-selection');
  });
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === 'media' || permission === 'speaker-selection',
  );
}

function createMainWindow(): BrowserWindow {
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
  void window.loadURL(rendererUrl(page));
  return window;
}

void app.whenReady().then(() => {
  registerAppProtocol();
  allowMediaPermissions();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
