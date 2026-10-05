// window.holo for tests: an in-memory main process whose answers a test can set and whose
// calls it can inspect.
import { createAppError, fail, ok, type AppError, type Result } from '@shared/errors';
import type {
  AppInfo,
  HoloApi,
  LoadedAudioFile,
  MediaKind,
  PermissionStatus,
  PickedAudioFile,
} from '@shared/ipc';
import type { ReferenceAnalysis } from '@shared/music';
import { DEFAULT_SETTINGS, type DeepPartial, type Settings } from '@shared/settings';
import { mergeSettings } from '@shared/settingsSchema';
import type {
  ExportProgress,
  ExportRequest,
  ExportResult,
  TakeAudioChunk,
  TakeInit,
  TakeManifest,
} from '@shared/take';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

export function loadedFile(path: string, sha256: string, byteLength = 3000): LoadedAudioFile {
  const name = path.split('/').pop() ?? path;
  return { path, name, sizeBytes: byteLength, sha256, bytes: new ArrayBuffer(byteLength) };
}

export class FakeHoloApi {
  readonly log: Array<{ name: string; args: unknown[] }> = [];
  appInfo: AppInfo = { version: '0.1.0', platform: 'darwin', isE2E: false };
  storedSettings: Settings = structuredClone(DEFAULT_SETTINGS);
  /** When set, the next settings.update rejects with it. */
  failNextSettingsUpdate: Error | null = null;
  permissionStatus: Record<MediaKind, PermissionStatus> = {
    microphone: 'granted',
    camera: 'granted',
  };
  /** What the system "answers" when asked. */
  permissionAnswer: Record<MediaKind, PermissionStatus> = {
    microphone: 'granted',
    camera: 'granted',
  };
  pickedFile: PickedAudioFile | null = null;
  readonly files = new Map<string, LoadedAudioFile | AppError>();
  /** Reads of these paths wait until the gate is opened. */
  readonly readGates = new Map<string, Promise<void>>();
  readonly analysisCache = new Map<string, ReferenceAnalysis>();
  beginResult: Result<{ takeId: string }> | null = null;
  finishResult: Result<{ durationSec: number }> | null = null;
  readonly appendedAudio: Array<{ takeId: string; chunk: TakeAudioChunk }> = [];
  readonly appendedVideo: Array<{ takeId: string; chunk: ArrayBuffer }> = [];
  readonly finished: Array<{ takeId: string; manifest: TakeManifest }> = [];
  readonly discarded: string[] = [];
  savePath: string | null = '/Users/singer/Movies/take.mp4';
  /** When set, export.start waits for it; otherwise it succeeds at once. */
  exportOutcome: Deferred<Result<ExportResult>> | null = null;
  readonly exportRequests: ExportRequest[] = [];
  private readonly progressListeners = new Set<(progress: ExportProgress) => void>();
  private takeCount = 0;

  private record(name: string, ...args: unknown[]): void {
    this.log.push({ name, args });
  }

  callsNamed(name: string): unknown[][] {
    return this.log.filter((call) => call.name === name).map((call) => call.args);
  }

  emitProgress(progress: ExportProgress): void {
    for (const listener of this.progressListeners) listener(progress);
  }

  get progressListenerCount(): number {
    return this.progressListeners.size;
  }

  readonly api: HoloApi = {
    app: {
      getInfo: async () => this.appInfo,
    },
    settings: {
      load: async () => structuredClone(this.storedSettings),
      update: async (patch: DeepPartial<Settings>) => {
        this.record('settings.update', patch);
        const failure = this.failNextSettingsUpdate;
        this.failNextSettingsUpdate = null;
        if (failure) throw failure;
        this.storedSettings = mergeSettings(this.storedSettings, patch);
        return structuredClone(this.storedSettings);
      },
      reset: async () => structuredClone(DEFAULT_SETTINGS),
    },
    permissions: {
      getStatus: async (kind) => this.permissionStatus[kind],
      request: async (kind) => {
        this.record('permissions.request', kind);
        this.permissionStatus[kind] = this.permissionAnswer[kind];
        return this.permissionStatus[kind];
      },
      openSystemSettings: async (kind) => {
        this.record('permissions.openSystemSettings', kind);
      },
    },
    files: {
      pickAudioFile: async (purpose) => {
        this.record('files.pickAudioFile', purpose);
        return this.pickedFile;
      },
      readAudioFile: async (path) => {
        this.record('files.readAudioFile', path);
        await this.readGates.get(path);
        const file = this.files.get(path);
        if (!file) return fail('file-read-failed', `No such file: ${path}`);
        return 'bytes' in file ? ok(file) : { ok: false, error: file };
      },
      pathForDroppedFile: () => '',
    },
    analysisCache: {
      get: async (key) => this.analysisCache.get(key) ?? null,
      put: async (key, analysis) => {
        this.record('analysisCache.put', key);
        this.analysisCache.set(key, analysis);
      },
    },
    take: {
      begin: async (init: TakeInit) => {
        this.record('take.begin', init);
        if (this.beginResult) return this.beginResult;
        this.takeCount += 1;
        return ok({ takeId: `take-${this.takeCount}` });
      },
      appendAudio: (takeId, chunk) => {
        this.appendedAudio.push({ takeId, chunk });
      },
      appendVideo: (takeId, chunk) => {
        this.appendedVideo.push({ takeId, chunk });
      },
      finish: async (takeId, manifest) => {
        this.record('take.finish', takeId, manifest);
        this.finished.push({ takeId, manifest });
        if (this.finishResult && !this.finishResult.ok) return this.finishResult;
        const durationSec =
          this.finishResult?.value.durationSec ?? manifest.audioFrames / manifest.sampleRate;
        return ok({ takeId, durationSec, audioBytes: 0, videoBytes: 0 });
      },
      discard: async (takeId) => {
        this.record('take.discard', takeId);
        this.discarded.push(takeId);
      },
    },
    exporter: {
      chooseSavePath: async (defaultFileName) => {
        this.record('exporter.chooseSavePath', defaultFileName);
        return this.savePath;
      },
      start: async (request) => {
        this.record('exporter.start', request);
        this.exportRequests.push(request);
        if (this.exportOutcome) return this.exportOutcome.promise;
        return ok({ outputPath: request.outputPath, durationSec: 5, sizeBytes: 1000 });
      },
      cancel: async (takeId) => {
        this.record('exporter.cancel', takeId);
      },
      onProgress: (listener) => {
        this.progressListeners.add(listener);
        return () => {
          this.progressListeners.delete(listener);
        };
      },
      openFile: async (path) => {
        this.record('exporter.openFile', path);
      },
      showInFolder: async (path) => {
        this.record('exporter.showInFolder', path);
      },
    },
  };
}

export function exportFailure(): Result<ExportResult> {
  return { ok: false, error: createAppError('export-failed', 'ffmpeg exited with code 1') };
}
