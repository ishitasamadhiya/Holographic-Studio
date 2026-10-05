// A "take" is one recording. While recording, the renderer streams raw material to the main
// process, which writes it to a temporary folder. Exporting turns that folder into one MP4.
import type { RecordingMode } from './settings';

/** Both stems are raw little-endian Float32 PCM, interleaved stereo, at the take's sample rate. */
export const STEM_CHANNELS = 2;
export const STEM_BYTES_PER_FRAME = STEM_CHANNELS * Float32Array.BYTES_PER_ELEMENT;

export interface TakeInit {
  mode: RecordingMode;
  /** Sample rate of the audio engine (normally 48000). */
  sampleRate: number;
  /** Present in video mode: container/codec of the chunks MediaRecorder will produce. */
  video?: {
    mimeType: string;
    width: number;
    height: number;
    frameRate: number;
  };
}

/**
 * One block of captured audio. `vocal` and `backing` always hold the same number of frames,
 * captured in lockstep on the audio thread, so frame N of one lines up with frame N of the other.
 */
export interface TakeAudioChunk {
  /** Processed vocal (after autotune, echo, reverb and vocal volume). */
  vocal: ArrayBuffer;
  /** Backing track exactly as heard (after backing volume). Silence when there is none. */
  backing: ArrayBuffer;
}

/**
 * Everything the exporter needs to line the three recordings up.
 *
 * Clock model — all times are seconds, measured from the first captured audio frame:
 *   - Backing stem frame at stem time `a` was HEARD by the singer at wall time  W0 + a.
 *   - Vocal stem frame at stem time `a` was SUNG at wall time                   W0 + a - vocalLatencySec
 *     (it reached the recorder late by the output + input + processing latency).
 *   - The first video frame was captured at wall time                          W0 + video.startOffsetSec.
 *
 * The exported timeline starts at the first video frame (or at W0 in audio-only mode).
 * Output time t therefore plays  backing[t + S]  and  vocal[t + S + vocalLatencySec],
 * where S = video.startOffsetSec (0 in audio-only mode). Negative indexes are silence.
 */
export interface TakeManifest {
  mode: RecordingMode;
  sampleRate: number;
  /** Frames captured per stem (pauses are already cut out of stems and video alike). */
  audioFrames: number;
  /** Total delay of the recorded vocal relative to the backing as heard, user fine-tune included. */
  vocalLatencySec: number;
  hasBacking: boolean;
  video?: {
    /** Capture time of the first video frame relative to W0, user fine-tune included. */
    startOffsetSec: number;
    durationSec: number;
    width: number;
    height: number;
    frameRate: number;
  };
  /** Diagnostic breakdown of the latency estimate (not used by the exporter). */
  diagnostics?: {
    inputLatencySec: number;
    outputLatencySec: number;
    processingLatencySec: number;
    cameraLatencySec?: number;
    pauses: number;
  };
}

export interface TakeSummary {
  takeId: string;
  durationSec: number;
  audioBytes: number;
  videoBytes: number;
}

export interface ExportRequest {
  takeId: string;
  outputPath: string;
  /** Audio-only mode: PNG artwork (1920x1080) shown for the whole video. */
  artworkPng?: ArrayBuffer;
}

export type ExportStage = 'mixing' | 'encoding' | 'finishing';

export interface ExportProgress {
  takeId: string;
  stage: ExportStage;
  /** Overall progress, 0..1. */
  fraction: number;
}

export interface ExportResult {
  outputPath: string;
  durationSec: number;
  sizeBytes: number;
}

/** Holographic-Studio-Take-YYYY-MM-DD-HHMM.mp4 in local time. */
export function defaultTakeFileName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `Holographic-Studio-Take-${day}-${time}.mp4`;
}
