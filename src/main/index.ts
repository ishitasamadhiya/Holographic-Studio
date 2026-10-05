import { app, BrowserWindow } from 'electron';
import { startServices } from './services';
import { applyTestEnvironment } from './testEnvironment';
import { installAppMenu } from './window/appMenu';
import { registerAppProtocol, registerAppScheme } from './window/appProtocol';
import { allowMediaPermissions, createMainWindow } from './window/mainWindow';

// Both must run before the app is ready: fake devices and the userData override are startup
// switches, and a privileged scheme can only be registered up front.
applyTestEnvironment();
registerAppScheme();

void app.whenReady().then(() => {
  registerAppProtocol();
  allowMediaPermissions();
  installAppMenu({
    isDevelopment: Boolean(process.env.ELECTRON_RENDERER_URL),
    platform: process.platform,
  });
  startServices();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
