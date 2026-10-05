// The one facade the rest of the app uses to talk to live audio. Everything behind it
// (AudioContext graph, worklets, devices) can change — or be replaced by a native engine —
// without touching the recording controller or the UI.
import type { ControlValues } from '@shared/controls';
import type { AppError, Result } from '@shared/errors';
import type { Unsubscribe } from '@shared/ipc';
import type { PitchTargetData } from '@shared/music';
import type { TakeAudioChunk } from '@shared/take';
import type { LatencyBreakdown, OutputClock } from '@renderer/recording/syncTimeline';

export interface EngineStartOptions {
  /** null = system default. */
  microphoneId: string | null;
  outputId: string | null;
}

/** Mix settings that are not gesture-controlled. Mirrors Settings.audio. */
export interface MixSettings {
  /** Microphone input trim, linear 0..2. Recorded. */
  micGain: number;
  /** Whether the singer hears their own processed voice. Headphones only. */
  monitoringEnabled: boolean;
  /** Own-voice level in the headphones, 0..1. Headphones only. */
  monitorVolume: number;
  /** Backing track level, 0..1. Heard and recorded. */
  backingVolume: number;
  reverbEnabled: boolean;
}

export interface EngineMeters {
  /** Peak microphone level since the last read, 0..1 (after the input trim). */
  inputLevel: number;
  /** Peak processed-vocal level since the last read, 0..1. */
  outputLevel: number;
  /** Sung pitch as a fractional MIDI note, or null when no pitch is detected. */
  detectedMidi: number | null;
  /** Note the autotune is pulling toward, or null. */
  targetMidi: number | null;
  correctionCents: number;
}

export interface CaptureStarted {
  /** Audio-clock time of the first captured frame. */
  startContextTimeSec: number;
}

export interface CaptureFinished {
  /** Frames captured per stem, pauses excluded. */
  frames: number;
}

export interface BackingStartOptions {
  /** Position in the track to start from. Default 0. */
  offsetSec?: number;
  /** Audio-clock time at which playback begins. Default: as soon as possible. */
  atContextTimeSec?: number;
}

export interface AudioEngine {
  readonly isRunning: boolean;
  /** Sample rate of the running engine (48000 unless the device forces another rate). */
  readonly sampleRate: number;
  /** False where the platform cannot route audio to a chosen output device. */
  readonly outputSelectionSupported: boolean;

  /**
   * Opens the microphone, builds the audio graph, and starts live monitoring.
   * Calling it while running restarts with the new devices.
   */
  start(options: EngineStartOptions): Promise<Result<void>>;
  stop(): Promise<void>;
  setMicrophone(deviceId: string | null): Promise<Result<void>>;
  setOutput(deviceId: string | null): Promise<Result<void>>;

  setMix(mix: Partial<MixSettings>): void;
  /** Live control values, 0..1 each. Cheap; call it on every gesture frame. */
  setControls(values: ControlValues): void;
  /** Pitch targets for the autotune. null = nearest semitone. */
  setPitchTargets(targets: PitchTargetData | null): void;

  /** Decodes MP3 / WAV / M4A (and whatever else Chromium can) to the engine's sample rate. */
  decodeAudioFile(bytes: ArrayBuffer): Promise<Result<AudioBuffer>>;
  setBackingTrack(buffer: AudioBuffer | null): void;
  readonly hasBackingTrack: boolean;

  /** The audio clock (AudioContext.currentTime). 0 while stopped. */
  readonly currentTimeSec: number;
  /** Schedules backing playback; returns the audio-clock time at which it actually starts. */
  startBacking(options?: BackingStartOptions): number;
  /** Stops playback at the given audio-clock time (default: now); returns the song position there. */
  stopBacking(atContextTimeSec?: number): number;
  readonly isBackingPlaying: boolean;
  /** Song position as heard right now, or null when the backing track is not playing. */
  getSongPositionSec(): number | null;
  /** Fires when the backing track plays through to its end (not when it is stopped). */
  onBackingEnded(listener: () => void): Unsubscribe;

  /**
   * Starts capturing the vocal and backing stems in lockstep. Capture timing is frame-exact:
   * each call takes effect at the given audio-clock time (default: as soon as possible).
   */
  startCapture(atContextTimeSec?: number): Promise<CaptureStarted>;
  pauseCapture(atContextTimeSec?: number): Promise<void>;
  resumeCapture(atContextTimeSec?: number): Promise<void>;
  /** Resolves after the final chunk has been delivered to onStemChunk listeners. */
  stopCapture(): Promise<CaptureFinished>;
  onStemChunk(listener: (chunk: TakeAudioChunk) => void): Unsubscribe;

  getLatency(): LatencyBreakdown;
  /** Mapping between the audio clock and performance.now(), kept fresh while running. */
  getOutputClock(): OutputClock;
  /** Reads and resets the peak meters. Poll it from the UI at display rate. */
  readMeters(): EngineMeters;
  /** Plays a short, pleasant test sound through the selected output. */
  playTestSound(): Promise<void>;

  /** Runtime failures, e.g. the microphone being unplugged. */
  onError(listener: (error: AppError) => void): Unsubscribe;
}
