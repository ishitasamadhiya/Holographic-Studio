import { BrowserWindow, shell, type WebContents } from 'electron';
import { stat } from 'node:fs/promises';
import { fail } from '@shared/errors';
import type { AppInfo, PermissionStatus } from '@shared/ipc';
import type { ReferenceAnalysis } from '@shared/music';
import type { DeepPartial, Settings } from '@shared/settings';
import type { ExportProgress, TakeInit, TakeManifest } from '@shared/take';
import type { AnalysisCache } from '../analysisCache/analysisCache';
import type { ExportJobs } from '../export/exportJobs';
import { exportTake } from '../export/exportTake';
import { chooseSavePath } from '../export/saveDialog';
import { isAudioFilePurpose, pickAudioFile } from '../files/audioFilePicker';
import { readAudioFile } from '../files/audioFileReader';
import { isMediaKind, type MediaPermissions } from '../permissions/mediaPermissions';
import type { SettingsStore } from '../settings/settingsStore';
import { isTakeId } from '../takes/takeFiles';
import type { TakeOwners } from '../takes/takeOwners';
import type { TakeStore } from '../takes/takeStore';
import { IPC_CHANNELS as IPC } from './channels';
import type { IpcRouter } from './ipcRouter';
import { isAbsolutePath, isMp4Path, isPlainObject, parseExportRequest, toBytes } from './payloads';

export interface IpcServices {
  appInfo: AppInfo;
  settings: SettingsStore;
  permissions: MediaPermissions;
  analysisCache: AnalysisCache;
  takes: TakeStore;
  /** Which page began which take, so the takes of a page that goes away can be cleaned up. */
  takeOwners: TakeOwners;
  exportJobs: ExportJobs;
  /** Null when the bundled FFmpeg does not support this platform. */
  ffmpegPath: string | null;
}

function windowOf(sender: WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender);
}

function registerAppHandlers(router: IpcRouter, { appInfo }: IpcServices): void {
  router.handle(IPC.appGetInfo, () => appInfo);
}

function registerSettingsHandlers(router: IpcRouter, { settings }: IpcServices): void {
  router.handle(IPC.settingsLoad, () => settings.load());
  router.handle(IPC.settingsUpdate, (_event, patch) =>
    // Anything that is not an object changes nothing.
    settings.update(isPlainObject(patch) ? (patch as DeepPartial<Settings>) : {}),
  );
  router.handle(IPC.settingsReset, () => settings.reset());
}

function registerPermissionHandlers(router: IpcRouter, { permissions }: IpcServices): void {
  router.handle(IPC.permissionsGetStatus, (_event, kind): PermissionStatus =>
    isMediaKind(kind) ? permissions.getStatus(kind) : 'unknown',
  );
  router.handle(IPC.permissionsRequest, async (_event, kind): Promise<PermissionStatus> =>
    isMediaKind(kind) ? permissions.request(kind) : 'unknown',
  );
  router.handle(IPC.permissionsOpenSystemSettings, async (_event, kind) => {
    if (isMediaKind(kind)) await permissions.openSystemSettings(kind);
  });
}

function registerFileHandlers(router: IpcRouter): void {
  router.handle(IPC.filesPickAudioFile, (event, purpose) =>
    isAudioFilePurpose(purpose) ? pickAudioFile(purpose, windowOf(event.sender)) : null,
  );
  router.handle(IPC.filesReadAudioFile, (_event, path) =>
    isAbsolutePath(path) ? readAudioFile(path) : fail('file-read-failed', 'Invalid file path'),
  );
}

function registerAnalysisCacheHandlers(router: IpcRouter, { analysisCache }: IpcServices): void {
  router.handle(IPC.analysisCacheGet, (_event, key) =>
    typeof key === 'string' ? analysisCache.get(key) : null,
  );
  router.handle(IPC.analysisCachePut, async (_event, key, analysis) => {
    try {
      await analysisCache.put(key as string, analysis as ReferenceAnalysis);
    } catch (error) {
      // The cache only saves time; failing to fill it must never break the analysis flow.
      console.warn('Could not cache the reference analysis:', error);
    }
  });
}

function registerTakeHandlers(router: IpcRouter, services: IpcServices): void {
  const { takes, takeOwners, exportJobs } = services;

  router.handle(IPC.takeBegin, async (event, init) => {
    const begun = await takes.begin(init as TakeInit);
    if (begun.ok) takeOwners.claim(begun.value.takeId, event.sender.id);
    return begun;
  });

  router.on(IPC.takeAppendAudio, (_event, takeId, vocal, backing) => {
    if (!isTakeId(takeId)) return;
    const vocalBytes = toBytes(vocal);
    const backingBytes = toBytes(backing);
    if (vocalBytes && backingBytes) takes.appendAudio(takeId, vocalBytes, backingBytes);
    else takes.markBroken(takeId, 'An audio chunk arrived in an unreadable form');
  });

  router.on(IPC.takeAppendVideo, (_event, takeId, chunk) => {
    if (!isTakeId(takeId)) return;
    const bytes = toBytes(chunk);
    if (bytes) takes.appendVideo(takeId, bytes);
    else takes.markBroken(takeId, 'A video chunk arrived in an unreadable form');
  });

  router.handle(IPC.takeFinish, (_event, takeId, manifest) =>
    isTakeId(takeId)
      ? takes.finish(takeId, manifest as TakeManifest)
      : fail('recording-failed', 'Invalid take id'),
  );

  router.handle(IPC.takeDiscard, async (_event, takeId) => {
    if (!isTakeId(takeId)) return;
    takeOwners.release(takeId);
    // An export still reading the take has to stop before its files can go.
    await exportJobs.cancel(takeId);
    await takes.discard(takeId);
  });
}

function registerExportHandlers(router: IpcRouter, services: IpcServices): void {
  const { settings, takes, takeOwners, exportJobs, ffmpegPath } = services;

  router.handle(IPC.exportChooseSavePath, (event, suggestedFileName) =>
    chooseSavePath(suggestedFileName, settings, windowOf(event.sender)),
  );

  router.handle(IPC.exportStart, async (event, rawRequest) => {
    const request = parseExportRequest(rawRequest);
    if (!request) return fail('export-failed', 'Invalid export request');
    const takeDir = takes.finishedTakeDir(request.takeId);
    if (!takeDir) return fail('export-failed', 'The take does not exist or is not finished');
    if (!ffmpegPath) return fail('export-failed', 'FFmpeg is not available on this platform');

    const sender = event.sender;
    return exportJobs.run(request.takeId, (signal) =>
      exportTake({
        takeDir,
        outputPath: request.outputPath,
        ffmpegPath,
        artworkPng: request.artworkPng,
        signal,
        onProgress: ({ stage, fraction }) => {
          // After a reload the window shows a new page that knows nothing about this take.
          if (sender.isDestroyed() || !takeOwners.isOwnedBy(request.takeId, sender.id)) return;
          const progress: ExportProgress = { takeId: request.takeId, stage, fraction };
          sender.send(IPC.exportProgress, progress);
        },
      }),
    );
  });

  router.handle(IPC.exportCancel, async (_event, takeId) => {
    if (isTakeId(takeId)) await exportJobs.cancel(takeId);
  });

  router.handle(IPC.exportOpenFile, async (_event, path) => {
    // Only finished exports are ever opened this way, so anything but an existing .mp4 is refused.
    if (!isMp4Path(path) || !(await isExistingFile(path))) return;
    const errorMessage = await shell.openPath(path);
    if (errorMessage) console.warn(`Could not open ${path}: ${errorMessage}`);
  });

  router.handle(IPC.exportShowInFolder, (_event, path) => {
    if (isAbsolutePath(path)) shell.showItemInFolder(path);
  });
}

async function isExistingFile(path: string): Promise<boolean> {
  return stat(path).then(
    (stats) => stats.isFile(),
    () => false,
  );
}

/** Wires every method of the HoloApi (src/shared/ipc.ts) to the services that implement it. */
export function registerIpcHandlers(router: IpcRouter, services: IpcServices): void {
  registerAppHandlers(router, services);
  registerSettingsHandlers(router, services);
  registerPermissionHandlers(router, services);
  registerFileHandlers(router);
  registerAnalysisCacheHandlers(router, services);
  registerTakeHandlers(router, services);
  registerExportHandlers(router, services);
}
