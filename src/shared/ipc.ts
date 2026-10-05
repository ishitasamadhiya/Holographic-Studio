// The complete API the sandboxed UI can call in the main process, exposed as `window.holo`.
// main implements it (src/main/ipc), preload bridges it (src/preload), the renderer consumes it.
import type { Result } from './errors';
import type { ReferenceAnalysis } from './music';
import type { DeepPartial, Settings } from './settings';
import type {
  ExportProgress,
  ExportRequest,
  ExportResult,
  TakeAudioChunk,
  TakeInit,
  TakeManifest,
  TakeSummary,
} from './take';

export type MediaKind = 'microphone' | 'camera';
export type PermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
export type AudioFilePurpose = 'backing' | 'reference';
export type Unsubscribe = () => void;

export interface AppInfo {
  version: string;
  /** process.platform of the main process, e.g. "darwin" or "win32". */
  platform: string;
  /** True when launched by the end-to-end tests (synthetic devices, muted output). */
  isE2E: boolean;
}

export interface PickedAudioFile {
  path: string;
  name: string;
  sizeBytes: number;
}

export interface LoadedAudioFile extends PickedAudioFile {
  /** Content hash; used as the reference-analysis cache key. */
  sha256: string;
  bytes: ArrayBuffer;
}

export const SUPPORTED_AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'aiff', 'flac', 'ogg'];

export interface HoloApi {
  app: {
    getInfo(): Promise<AppInfo>;
  };

  settings: {
    load(): Promise<Settings>;
    /** Deep-merges the patch, validates, persists atomically, and returns the full settings. */
    update(patch: DeepPartial<Settings>): Promise<Settings>;
    reset(): Promise<Settings>;
  };

  permissions: {
    getStatus(kind: MediaKind): Promise<PermissionStatus>;
    /** Triggers the macOS prompt when the status is 'not-determined'. */
    request(kind: MediaKind): Promise<PermissionStatus>;
    openSystemSettings(kind: MediaKind): Promise<void>;
  };

  files: {
    /** Native open dialog. Resolves null when the user cancels. */
    pickAudioFile(purpose: AudioFilePurpose): Promise<PickedAudioFile | null>;
    readAudioFile(path: string): Promise<Result<LoadedAudioFile>>;
    /** Absolute path of a file dropped onto the window (preload-only helper). */
    pathForDroppedFile(file: File): string;
  };

  analysisCache: {
    /** `key` is the reference file's sha256. Resolves null on a miss or a schema mismatch. */
    get(key: string): Promise<ReferenceAnalysis | null>;
    put(key: string, analysis: ReferenceAnalysis): Promise<void>;
  };

  take: {
    begin(init: TakeInit): Promise<Result<{ takeId: string }>>;
    /** Fire-and-forget; chunks are written in the order they are sent. */
    appendAudio(takeId: string, chunk: TakeAudioChunk): void;
    appendVideo(takeId: string, chunk: ArrayBuffer): void;
    /** Flushes everything to disk and stores the manifest. */
    finish(takeId: string, manifest: TakeManifest): Promise<Result<TakeSummary>>;
    /** Deletes the take's temporary files. Safe to call for unknown ids. */
    discard(takeId: string): Promise<void>;
  };

  exporter: {
    /** Native save dialog. Resolves null when the user cancels. */
    chooseSavePath(defaultFileName: string): Promise<string | null>;
    start(request: ExportRequest): Promise<Result<ExportResult>>;
    cancel(takeId: string): Promise<void>;
    onProgress(listener: (progress: ExportProgress) => void): Unsubscribe;
    openFile(path: string): Promise<void>;
    showInFolder(path: string): Promise<void>;
  };
}
