// Messages between the engine (UI thread) and its two AudioWorklet processors. Imported by
// both sides, so it must stay free of DOM and worklet globals.
import type { PitchTargetData } from '@shared/music';
import type { SongClockState } from './songClock';
import type { CaptureCommand } from './stemCapture';

export const VOCAL_CHAIN_PROCESSOR = 'vocal-chain';
export const STEM_RECORDER_PROCESSOR = 'stem-recorder';

/**
 * Everything the vocal chain needs apart from the three live controls, which are k-rate
 * AudioParams named after their ControlId ('autotune', 'echo', 'volume').
 */
export type VocalChainRequest =
  | { type: 'mix'; micGain: number; reverbEnabled: boolean }
  | { type: 'pitch-targets'; targets: PitchTargetData | null }
  | {
      type: 'song-clock';
      /** null = no backing playback. */
      clock: SongClockState | null;
      /** Input latency + output latency, in seconds. */
      roundTripLatencySec: number;
    };

export interface VocalReadyMessage {
  type: 'ready';
  /** VocalChain.latencySamples. */
  latencySamples: number;
}

/** Mirrors VocalChainMeters: pitches are NaN while unvoiced. */
export interface VocalMetersMessage {
  type: 'meters';
  inputPeak: number;
  outputPeak: number;
  detectedMidi: number;
  targetMidi: number;
  correctionCents: number;
}

export type VocalChainEvent = VocalReadyMessage | VocalMetersMessage;

export interface RecorderRequest {
  /** Echoed in the 'scheduled' reply. */
  id: number;
  command: CaptureCommand;
  /** Audio-clock frame on which the command takes effect. */
  frame: number;
}

export type RecorderEvent =
  | {
      type: 'scheduled';
      id: number;
      /** The frame really used (never earlier than requested); null = command refused. */
      frame: number | null;
    }
  | { type: 'chunk'; vocal: ArrayBuffer; backing: ArrayBuffer }
  | { type: 'stopped'; frames: number };
