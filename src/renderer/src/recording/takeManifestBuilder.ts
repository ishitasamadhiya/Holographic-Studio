// Turns what the recording controller observed during a take into the TakeManifest the
// exporter lines everything up with (clock model: src/shared/take.ts).
import type { RecordingMode, Settings } from '@shared/settings';
import type { TakeManifest } from '@shared/take';
import {
  computeVideoStartOffsetSec,
  computeVocalLatencySec,
  estimateFirstFrameCaptureMs,
  type LatencyBreakdown,
  type OutputClock,
} from './syncTimeline';

export interface RecordedVideoTiming {
  /** performance.now() time from which the recorder took frames. */
  recorderStartedMs: number;
  /** How long the recorder was taking frames, pauses excluded. */
  activeDurationSec: number;
  width: number;
  height: number;
  frameRate: number;
  /** Sensor-to-app delay of the camera. */
  cameraLatencyMs: number;
}

export interface TakeManifestInput {
  mode: RecordingMode;
  sampleRate: number;
  /** Frames captured per stem, pauses excluded. */
  audioFrames: number;
  hasBacking: boolean;
  pauses: number;
  latency: LatencyBreakdown;
  sync: Settings['sync'];
  /** Audio-clock time of the first captured frame. */
  captureStartContextSec: number;
  clock: OutputClock;
  /** Null for an Audio Only take. */
  video: RecordedVideoTiming | null;
}

export function buildTakeManifest(input: TakeManifestInput): TakeManifest {
  const { latency, sync, video } = input;
  const vocalLatencySec = computeVocalLatencySec(latency, sync.vocalOffsetMs);
  const manifest: TakeManifest = {
    mode: input.mode,
    sampleRate: input.sampleRate,
    audioFrames: input.audioFrames,
    vocalLatencySec,
    hasBacking: input.hasBacking,
    diagnostics: {
      inputLatencySec: latency.inputSec,
      outputLatencySec: latency.outputSec,
      processingLatencySec: latency.processingSec,
      pauses: input.pauses,
    },
  };
  if (input.mode !== 'video' || !video) return manifest;

  const startOffsetSec = computeVideoStartOffsetSec({
    firstFrameCaptureMs: estimateFirstFrameCaptureMs({
      recorderStartedMs: video.recorderStartedMs,
      frameIntervalMs: 1000 / video.frameRate,
      cameraLatencyMs: video.cameraLatencyMs,
    }),
    captureStartContextSec: input.captureStartContextSec,
    clock: input.clock,
    userOffsetMs: sync.videoOffsetMs,
  });

  // The camera keeps rolling for a moment after the audio has stopped. The picture is cut
  // where the latency-shifted vocal runs out, so the export never ends on a silent tail.
  const audioSec = input.audioFrames / input.sampleRate;
  const audioEndsAtSec = audioSec - startOffsetSec - Math.max(0, vocalLatencySec);
  const durationSec = Math.min(video.activeDurationSec, audioEndsAtSec);
  if (!(durationSec > 0)) {
    throw new RangeError('The camera recording does not overlap the recorded audio');
  }

  manifest.video = {
    startOffsetSec,
    durationSec,
    width: video.width,
    height: video.height,
    frameRate: video.frameRate,
  };
  if (manifest.diagnostics) manifest.diagnostics.cameraLatencySec = video.cameraLatencyMs / 1000;
  return manifest;
}
