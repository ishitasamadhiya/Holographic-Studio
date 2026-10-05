import { contextBridge } from 'electron';

// The typed bridge between the sandboxed UI and the main process.
// The full API surface is defined in src/shared/ipc.ts (HoloApi).
contextBridge.exposeInMainWorld('holoBootstrap', {
  platform: process.platform,
});
