// An AudioEngine that records every call and lets a test drive capture, playback and
// failures by hand. Its audio clock follows the FakeClock, as a real context follows the
// wall clock.
import type {
  AudioEngine,
  BackingStartOptions,
  CaptureFinished,
  CaptureStarted,
  EngineMeters,
  EngineStartOptions,
  MixSettings,
} from '@renderer/audio/engineTypes';
import type { ControlValues } from '@shared/controls';
import { ok, type AppError, type Result } from '@shared/errors';
import type { Unsubscribe } from '@shared/ipc';
import type { PitchTargetData } from '@shared/music';
import { STEM_BYTES_PER_FRAME, type TakeAudioChunk } from '@shared/take';
import { OutputClock, type LatencyBreakdown } from '../syncTimeline';
import type { FakeClock } from './fakeClock';

export interface EngineCall {
  name: string;
  args: unknown[];
}

/** Node has no AudioBuffer; this has every member the app reads. */
export function fakeAudioBuffer(durationSec: number, sampleRate = 48000): AudioBuffer {
  const length = Math.round(durationSec * sampleRate);
  const channels = [new Float32Array(length), new Float32Array(length)];
  const buffer = {
    duration: durationSec,
    length,
    sampleRate,
    numberOfChannels: 2,
    getChannelData: (channel: number) => {
      const data = channels[channel];
      if (!data) throw new RangeError('No such channel');
      return data;
    },
  };
  return buffer as unknown as AudioBuffer;
}

/** Audio-clock time while the FakeClock reads its start time (1000 ms). */
export const FAKE_CONTEXT_ORIGIN_SEC = 5;
/** What the fake reports as its latency. */
export const FAKE_LATENCY: LatencyBreakdown = {
  inputSec: 0.01,
  outputSec: 0.02,
  processingSec: 0.005,
};

export class FakeEngine implements AudioEngine {
  readonly calls: EngineCall[] = [];
  running = false;
  sampleRate = 48000;
  outputSelectionSupported = true;
  hasBackingTrack = false;
  isBackingPlaying = false;
  latency: LatencyBreakdown = { ...FAKE_LATENCY };
  readonly outputClock = new OutputClock();
  /** Results for the next start() calls, in order; ok when the list is empty. */
  startResults: Array<Result<void>> = [];
  decodeResult: Result<AudioBuffer> | null = null;
  /** Song position stopBacking() reports. */
  backingPositionSec = 2;
  songPositionSec: number | null = null;
  meters: EngineMeters = {
    inputLevel: 0.4,
    outputLevel: 0.3,
    detectedMidi: 60.2,
    targetMidi: 60,
    correctionCents: -20,
  };
  controls: ControlValues | null = null;
  mix: Partial<MixSettings> = {};
  backingTrack: AudioBuffer | null = null;
  pitchTargets: PitchTargetData | null | undefined = undefined;
  capturedFrames = 0;
  /** When set, stopCapture() never settles (a device that stopped answering). */
  hangStopCapture = false;

  private readonly stemListeners = new Set<(chunk: TakeAudioChunk) => void>();
  private readonly backingEndedListeners = new Set<() => void>();
  private readonly errorListeners = new Set<(error: AppError) => void>();
  private chunkSequence = 0;

  constructor(private readonly clock: FakeClock) {
    // Sound rendered "now" is heard 20 ms later.
    const nowMs = clock.nowMs();
    this.outputClock.addSample({
      contextTimeSec: FAKE_CONTEXT_ORIGIN_SEC,
      performanceTimeMs: nowMs + FAKE_LATENCY.outputSec * 1000,
    });
    this.clockOriginMs = nowMs;
  }

  private readonly clockOriginMs: number;

  get isRunning(): boolean {
    return this.running;
  }

  get currentTimeSec(): number {
    if (!this.running) return 0;
    return FAKE_CONTEXT_ORIGIN_SEC + (this.clock.nowMs() - this.clockOriginMs) / 1000;
  }

  callsNamed(name: string): unknown[][] {
    return this.calls.filter((call) => call.name === name).map((call) => call.args);
  }

  private log(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args });
  }

  async start(options: EngineStartOptions): Promise<Result<void>> {
    this.log('start', options);
    const result = this.startResults.shift() ?? ok(undefined);
    if (result.ok) this.running = true;
    return result;
  }

  async stop(): Promise<void> {
    this.log('stop');
    this.running = false;
  }

  async setMicrophone(deviceId: string | null): Promise<Result<void>> {
    this.log('setMicrophone', deviceId);
    return ok(undefined);
  }

  async setOutput(deviceId: string | null): Promise<Result<void>> {
    this.log('setOutput', deviceId);
    return ok(undefined);
  }

  setMix(mix: Partial<MixSettings>): void {
    this.log('setMix', mix);
    this.mix = { ...this.mix, ...mix };
  }

  setControls(values: ControlValues): void {
    this.controls = { ...values };
  }

  setPitchTargets(targets: PitchTargetData | null): void {
    this.log('setPitchTargets', targets);
    this.pitchTargets = targets;
  }

  async decodeAudioFile(bytes: ArrayBuffer): Promise<Result<AudioBuffer>> {
    this.log('decodeAudioFile', bytes.byteLength);
    return this.decodeResult ?? ok(fakeAudioBuffer(bytes.byteLength / 1000));
  }

  setBackingTrack(buffer: AudioBuffer | null): void {
    this.log('setBackingTrack', buffer);
    this.backingTrack = buffer;
    this.hasBackingTrack = buffer !== null;
  }

  startBacking(options: BackingStartOptions = {}): number {
    this.log('startBacking', options);
    this.isBackingPlaying = true;
    return options.atContextTimeSec ?? this.currentTimeSec;
  }

  stopBacking(atContextTimeSec?: number): number {
    this.log('stopBacking', atContextTimeSec);
    this.isBackingPlaying = false;
    return this.backingPositionSec;
  }

  getSongPositionSec(): number | null {
    return this.songPositionSec;
  }

  onBackingEnded(listener: () => void): Unsubscribe {
    this.backingEndedListeners.add(listener);
    return () => this.backingEndedListeners.delete(listener);
  }

  async startCapture(atContextTimeSec?: number): Promise<CaptureStarted> {
    this.log('startCapture', atContextTimeSec);
    return { startContextTimeSec: atContextTimeSec ?? this.currentTimeSec };
  }

  async pauseCapture(atContextTimeSec?: number): Promise<void> {
    this.log('pauseCapture', atContextTimeSec);
  }

  async resumeCapture(atContextTimeSec?: number): Promise<void> {
    this.log('resumeCapture', atContextTimeSec);
  }

  stopCapture(): Promise<CaptureFinished> {
    this.log('stopCapture');
    if (this.hangStopCapture) return new Promise(() => undefined);
    return Promise.resolve({ frames: this.capturedFrames });
  }

  onStemChunk(listener: (chunk: TakeAudioChunk) => void): Unsubscribe {
    this.stemListeners.add(listener);
    return () => this.stemListeners.delete(listener);
  }

  getLatency(): LatencyBreakdown {
    return { ...this.latency };
  }

  getOutputClock(): OutputClock {
    return this.outputClock;
  }

  readMeters(): EngineMeters {
    return { ...this.meters };
  }

  async playTestSound(): Promise<void> {
    this.log('playTestSound');
  }

  onError(listener: (error: AppError) => void): Unsubscribe {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  // --- driven by tests --------------------------------------------------------------------

  /** Delivers one captured block; the first sample of each stem holds its sequence number. */
  emitChunk(frames: number): TakeAudioChunk {
    this.chunkSequence += 1;
    const vocal = new Float32Array((frames * STEM_BYTES_PER_FRAME) / 4);
    const backing = new Float32Array(vocal.length);
    vocal[0] = this.chunkSequence;
    backing[0] = this.chunkSequence;
    const chunk = { vocal: vocal.buffer, backing: backing.buffer };
    this.capturedFrames += frames;
    for (const listener of this.stemListeners) listener(chunk);
    return chunk;
  }

  /** The backing track played through to its end. */
  endBacking(): void {
    this.isBackingPlaying = false;
    for (const listener of this.backingEndedListeners) listener();
  }

  fail(error: AppError, stillRunning = false): void {
    this.running = stillRunning;
    for (const listener of this.errorListeners) listener(error);
  }

  get listenerCounts(): { stems: number; backingEnded: number; errors: number } {
    return {
      stems: this.stemListeners.size,
      backingEnded: this.backingEndedListeners.size,
      errors: this.errorListeners.size,
    };
  }
}
