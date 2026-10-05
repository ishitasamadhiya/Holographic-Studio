// The two songs of a session: the backing track (heard and recorded) and the reference song
// (analysed for its melody and key, never played). Keeps the autotune's pitch targets in step
// with whichever of them is loaded.
import {
  buildPitchTargets,
  type AlignmentEstimate,
  type AnalysisClient,
  type StereoPcm,
} from '@analysis/index';
import type { AudioEngine } from '@renderer/audio/engineTypes';
import type { BackingState, Notice, ReferenceState } from '@renderer/state/studioTypes';
import { createAppError, isAppError, type AppError } from '@shared/errors';
import type { HoloApi, LoadedAudioFile } from '@shared/ipc';
import { describeKey, type PitchTargetData, type ReferenceAnalysis } from '@shared/music';
import type { Settings } from '@shared/settings';

export interface SongLibraryOptions {
  api: Pick<HoloApi, 'files' | 'analysisCache'>;
  engine: AudioEngine;
  analysis: AnalysisClient;
  setBacking: (state: BackingState) => void;
  setReference: (state: ReferenceState) => void;
  /** Remembers the files for the next launch (Settings.lastSession). */
  rememberSession: (patch: Partial<Settings['lastSession']>) => void;
  notify: (kind: Notice['kind'], message: string) => void;
}

export interface LoadOptions {
  /** Restoring the last session: a file that is gone is simply not restored. */
  silent?: boolean;
}

interface LoadedSong {
  sha256: string;
  pcm: StereoPcm;
}

interface LoadedBacking extends LoadedSong {
  buffer: AudioBuffer;
}

interface LoadedReference extends LoadedSong {
  analysis: ReferenceAnalysis;
}

const NO_REFERENCE: ReferenceState = {
  status: 'none',
  file: null,
  progress: 0,
  keyLabel: null,
  melodyUsable: false,
  error: null,
};

/** Thrown inside a load that a newer request has replaced; never reaches the user. */
const SUPERSEDED = Symbol('superseded');

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Read and decode failures arrive as AppErrors; anything else is an unreadable file. */
function toReadError(cause: unknown): AppError {
  return isAppError(cause) ? cause : createAppError('file-read-failed', cause);
}

export function toStereoPcm(buffer: AudioBuffer): StereoPcm {
  return {
    left: buffer.getChannelData(0),
    right: buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null,
    sampleRate: buffer.sampleRate,
  };
}

export class SongLibrary {
  private backing: LoadedBacking | null = null;
  private reference: LoadedReference | null = null;
  private backingRequest = 0;
  private referenceRequest = 0;
  private targetsRequest = 0;
  private targets: PitchTargetData | null = null;
  private readonly alignments = new Map<string, AlignmentEstimate>();
  private targetsWork: Promise<void> = Promise.resolve();

  constructor(private readonly options: SongLibraryOptions) {}

  get backingBuffer(): AudioBuffer | null {
    return this.backing?.buffer ?? null;
  }

  /** The pitch targets currently handed to the engine (null = nearest semitone). */
  get pitchTargets(): PitchTargetData | null {
    return this.targets;
  }

  /** Resolves once the pitch targets reflect the songs loaded so far. */
  async whenTargetsSettled(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.targetsWork;
      await current;
    } while (current !== this.targetsWork);
  }

  /** Hands the loaded backing track and targets to the engine again (after it restarted). */
  restoreEngine(): void {
    const { engine } = this.options;
    engine.setBackingTrack(this.backingBuffer);
    engine.setPitchTargets(this.targets);
  }

  async loadBacking(path: string, options: LoadOptions = {}): Promise<void> {
    const { engine, setBacking } = this.options;
    const request = ++this.backingRequest;
    this.dropBacking();
    setBacking({
      status: 'loading',
      file: { name: fileNameOf(path), path, durationSec: 0 },
      error: null,
    });
    try {
      const file = await this.read(path, () => request !== this.backingRequest);
      const decoded = await engine.decodeAudioFile(file.bytes);
      if (request !== this.backingRequest) throw SUPERSEDED;
      if (!decoded.ok) throw decoded.error;

      const buffer = decoded.value;
      this.backing = { buffer, sha256: file.sha256, pcm: toStereoPcm(buffer) };
      engine.setBackingTrack(buffer);
      setBacking({
        status: 'ready',
        file: { name: file.name, path: file.path, durationSec: buffer.duration },
        error: null,
      });
      this.options.rememberSession({ backingPath: file.path });
      this.updateTargets();
    } catch (cause) {
      if (cause === SUPERSEDED) return;
      if (options.silent) {
        setBacking({ status: 'none', file: null, error: null });
        return;
      }
      const error = toReadError(cause);
      setBacking({ status: 'failed', file: null, error });
      this.options.notify('error', error.message);
    }
  }

  clearBacking(): void {
    this.backingRequest += 1;
    this.dropBacking();
    this.options.setBacking({ status: 'none', file: null, error: null });
    this.options.rememberSession({ backingPath: null });
  }

  async loadReference(path: string, options: LoadOptions = {}): Promise<void> {
    const { api, analysis, engine, setReference } = this.options;
    const request = ++this.referenceRequest;
    const isStale = (): boolean => request !== this.referenceRequest;
    const loadingFile = { name: fileNameOf(path), path, durationSec: 0 };
    this.reference = null;
    this.updateTargets();
    setReference({ ...NO_REFERENCE, status: 'loading', file: loadingFile });

    let file: LoadedAudioFile;
    let buffer: AudioBuffer;
    try {
      file = await this.read(path, isStale);
      const decoded = await engine.decodeAudioFile(file.bytes);
      if (isStale()) throw SUPERSEDED;
      if (!decoded.ok) throw decoded.error;
      buffer = decoded.value;
    } catch (cause) {
      if (cause === SUPERSEDED) return;
      if (options.silent) {
        setReference({ ...NO_REFERENCE });
        return;
      }
      this.failReference(toReadError(cause));
      return;
    }

    const songFile = { name: file.name, path: file.path, durationSec: buffer.duration };
    const pcm = toStereoPcm(buffer);
    try {
      let result = await api.analysisCache.get(file.sha256).catch(() => null);
      if (isStale()) return;
      if (!result) {
        setReference({ ...NO_REFERENCE, status: 'analyzing', file: songFile });
        result = await analysis.analyze(pcm, (fraction) => {
          if (isStale()) return;
          setReference({
            ...NO_REFERENCE,
            status: 'analyzing',
            file: songFile,
            progress: fraction,
          });
        });
        if (isStale()) return;
        void api.analysisCache.put(file.sha256, result).catch(() => undefined);
      }

      this.reference = { sha256: file.sha256, pcm, analysis: result };
      setReference({
        status: 'ready',
        file: songFile,
        progress: 1,
        keyLabel: describeKey(result.key),
        melodyUsable: result.quality !== 'poor',
        error: null,
      });
      this.options.rememberSession({ referencePath: file.path });
      this.updateTargets();
    } catch (cause) {
      if (isStale()) return;
      this.failReference(createAppError('analysis-failed', cause), songFile);
    }
  }

  clearReference(): void {
    this.referenceRequest += 1;
    this.reference = null;
    this.updateTargets();
    this.options.setReference({ ...NO_REFERENCE });
    this.options.rememberSession({ referencePath: null });
  }

  dispose(): void {
    this.backingRequest += 1;
    this.referenceRequest += 1;
    this.targetsRequest += 1;
    this.options.analysis.dispose();
  }

  private async read(path: string, isStale: () => boolean): Promise<LoadedAudioFile> {
    const read = await this.options.api.files.readAudioFile(path);
    if (isStale()) throw SUPERSEDED;
    if (!read.ok) throw read.error;
    return read.value;
  }

  private dropBacking(): void {
    if (!this.backing) return;
    this.backing = null;
    this.options.engine.setBackingTrack(null);
    this.updateTargets();
  }

  private failReference(error: AppError, file: ReferenceState['file'] = null): void {
    this.options.setReference({ ...NO_REFERENCE, status: 'failed', file, error });
    this.options.notify('error', error.message);
  }

  /**
   * Recomputes the pitch targets for the songs loaded now. Only the newest computation is
   * applied, however the alignments finish.
   */
  private updateTargets(): void {
    const request = ++this.targetsRequest;
    const backing = this.backing;
    const reference = this.reference;
    this.targetsWork = (async () => {
      let targets: PitchTargetData | null = null;
      if (reference) {
        const alignment = backing ? await this.alignmentOf(backing, reference) : null;
        targets = buildPitchTargets(reference.analysis, {
          hasSongClock: backing !== null,
          alignment,
        });
      }
      if (request !== this.targetsRequest) return;
      this.targets = targets;
      this.options.engine.setPitchTargets(targets);
    })().catch((error: unknown) => {
      console.warn('Pitch targets could not be updated', error);
    });
  }

  /**
   * Where the reference sits relative to the backing track. A failed estimate counts as
   * unknown (confidence 0), so the melody is not used while the key still is; it is tried
   * again the next time either song changes.
   */
  private async alignmentOf(
    backing: LoadedBacking,
    reference: LoadedReference,
  ): Promise<AlignmentEstimate> {
    const key = `${backing.sha256}:${reference.sha256}`;
    const known = this.alignments.get(key);
    if (known) return known;
    try {
      const estimate = await this.options.analysis.align(backing.pcm, reference.pcm);
      this.alignments.set(key, estimate);
      return estimate;
    } catch {
      return { offsetSec: 0, confidence: 0 };
    }
  }
}
