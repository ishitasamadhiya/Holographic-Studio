// The bridge between the sandboxed UI and the main process: implements window.holo
// (HoloApi, src/shared/ipc.ts) on top of IPC. This file runs in the sandbox, so it may
// only use the `electron` module — everything else it imports is types or plain constants.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { HoloApi } from '@shared/ipc';
import type { ExportProgress } from '@shared/take';
import { IPC_CHANNELS as IPC } from '../main/ipc/channels';

const api: HoloApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
  },

  settings: {
    load: () => ipcRenderer.invoke(IPC.settingsLoad),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    reset: () => ipcRenderer.invoke(IPC.settingsReset),
  },

  permissions: {
    getStatus: (kind) => ipcRenderer.invoke(IPC.permissionsGetStatus, kind),
    request: (kind) => ipcRenderer.invoke(IPC.permissionsRequest, kind),
    openSystemSettings: (kind) => ipcRenderer.invoke(IPC.permissionsOpenSystemSettings, kind),
  },

  files: {
    pickAudioFile: (purpose) => ipcRenderer.invoke(IPC.filesPickAudioFile, purpose),
    readAudioFile: (path) => ipcRenderer.invoke(IPC.filesReadAudioFile, path),
    pathForDroppedFile: (file) => webUtils.getPathForFile(file),
  },

  analysisCache: {
    get: (key) => ipcRenderer.invoke(IPC.analysisCacheGet, key),
    put: (key, analysis) => ipcRenderer.invoke(IPC.analysisCachePut, key, analysis),
  },

  take: {
    begin: (init) => ipcRenderer.invoke(IPC.takeBegin, init),
    // send() keeps messages in order, and finish() travels on the same pipe, so every
    // chunk sent before finish() is written before the take is closed.
    appendAudio: (takeId, chunk) => {
      ipcRenderer.send(IPC.takeAppendAudio, takeId, chunk.vocal, chunk.backing);
    },
    appendVideo: (takeId, chunk) => {
      ipcRenderer.send(IPC.takeAppendVideo, takeId, chunk);
    },
    finish: (takeId, manifest) => ipcRenderer.invoke(IPC.takeFinish, takeId, manifest),
    discard: (takeId) => ipcRenderer.invoke(IPC.takeDiscard, takeId),
  },

  exporter: {
    chooseSavePath: (defaultFileName) =>
      ipcRenderer.invoke(IPC.exportChooseSavePath, defaultFileName),
    start: (request) => ipcRenderer.invoke(IPC.exportStart, request),
    cancel: (takeId) => ipcRenderer.invoke(IPC.exportCancel, takeId),
    onProgress: (listener) => {
      const forward = (_event: IpcRendererEvent, progress: ExportProgress): void => {
        listener(progress);
      };
      ipcRenderer.on(IPC.exportProgress, forward);
      return () => {
        ipcRenderer.removeListener(IPC.exportProgress, forward);
      };
    },
    openFile: (path) => ipcRenderer.invoke(IPC.exportOpenFile, path),
    showInFolder: (path) => ipcRenderer.invoke(IPC.exportShowInFolder, path),
  },
};

contextBridge.exposeInMainWorld('holo', api);
