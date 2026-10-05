import { join } from 'node:path';
import { app, ipcMain, shell, systemPreferences } from 'electron';
import ffmpegStaticPath from 'ffmpeg-static';
import { version as appVersion } from '../../package.json';
import { AnalysisCache } from './analysisCache/analysisCache';
import { ExportJobs } from './export/exportJobs';
import { resolveFfmpegPath } from './export/ffmpegBinary';
import { IpcRouter } from './ipc/ipcRouter';
import { registerIpcHandlers } from './ipc/registerIpcHandlers';
import { createSenderCheck } from './ipc/trustedSender';
import { MediaPermissions } from './permissions/mediaPermissions';
import { SettingsStore } from './settings/settingsStore';
import { finishWorkBeforeQuitting } from './shutdown/quitGuard';
import { abandonTakesOf, TakeOwners } from './takes/takeOwners';
import { TakeStore } from './takes/takeStore';
import { isE2E } from './testEnvironment';
import { PendingWork } from './util/pendingWork';
import { APP_ORIGIN, rendererBaseUrl } from './window/appProtocol';
import { onPageGone } from './window/pageLifetime';

/**
 * Creates the main-process services, rooted in the user-data folder, and exposes them to
 * the UI over IPC. Call once, after the app is ready and before the first window loads.
 */
export function startServices(): void {
  const userDataDir = app.getPath('userData');
  const takes = new TakeStore(join(userDataDir, 'takes'));
  const takeOwners = new TakeOwners();
  const exportJobs = new ExportJobs();
  const cleanup = new PendingWork();

  const permissions = new MediaPermissions({
    platform: process.platform,
    isE2E: isE2E(),
    system: {
      getMediaAccessStatus: (kind) => systemPreferences.getMediaAccessStatus(kind),
      askForMediaAccess: (kind) => systemPreferences.askForMediaAccess(kind),
      openExternal: (url) => shell.openExternal(url),
    },
  });

  const router = new IpcRouter(ipcMain, createSenderCheck([APP_ORIGIN, rendererBaseUrl()]));
  registerIpcHandlers(router, {
    // app.getVersion() reports Electron's own version when the app is started from a script
    // path (as the end-to-end tests do), so the version is taken from package.json at build time.
    appInfo: { version: appVersion, platform: process.platform, isE2E: isE2E() },
    settings: new SettingsStore(userDataDir),
    permissions,
    analysisCache: new AnalysisCache(join(userDataDir, 'analysis-cache')),
    takes,
    takeOwners,
    exportJobs,
    ffmpegPath: resolveFfmpegPath(ffmpegStaticPath),
  });

  // A page that reloads, crashes or closes can no longer finish or discard its recordings.
  app.on('web-contents-created', (_event, contents) => {
    const pageId = contents.id;
    onPageGone(contents, () => {
      cleanup.track(
        abandonTakesOf(pageId, takeOwners, takes).catch((error: unknown) => {
          console.warn('Could not clean up the recordings of a closed page:', error);
        }),
      );
    });
  });

  // Recordings left behind by a crash or an abandoned session.
  takes.removeStaleTakes().catch((error: unknown) => {
    console.warn('Could not clean up old takes:', error);
  });

  // Once the last window has closed nothing can use a running export or an unfinished
  // recording any more. Stop them and wait for their files to be removed before exiting, so
  // no FFmpeg process, half-written video or orphaned recording outlives the app.
  finishWorkBeforeQuitting(app, {
    isPending: () =>
      exportJobs.hasRunning || takes.unfinishedTakeIds().length > 0 || !cleanup.isIdle,
    finish: async () => {
      await exportJobs.cancelAll();
      await Promise.all(takes.unfinishedTakeIds().map((takeId) => takes.discard(takeId)));
      await cleanup.idle();
    },
  });
}
