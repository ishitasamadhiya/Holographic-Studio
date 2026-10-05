import type { TakeManifest } from '@shared/take';

/** Where each stem is read from to build the exported audio. All values are whole frames. */
export interface MixPlan {
  sampleRate: number;
  /** Frames captured per stem. Reads outside 0..stemFrames are silence. */
  stemFrames: number;
  /** Length of the exported audio. */
  outputFrames: number;
  /** Backing stem frame that plays at output frame 0. Negative: the output starts in silence. */
  backingStartFrame: number;
  /** Vocal stem frame that plays at output frame 0. */
  vocalStartFrame: number;
}

/**
 * Turns the clock model documented on TakeManifest into frame offsets:
 * output time t plays backing[t + S] and vocal[t + S + vocalLatency], where S is the video
 * start offset (0 in audio-only mode). Offsets are rounded to the nearest frame — at most
 * half a sample (about 10 microseconds) of error.
 *
 * With video the audio is exactly as long as the video. Without it the audio ends where the
 * latency-shifted vocal runs out, so the last moments of backing that the singer's reply was
 * never captured for are trimmed.
 */
export function planMix(manifest: TakeManifest): MixPlan {
  const { sampleRate, audioFrames, vocalLatencySec } = manifest;

  if (manifest.mode === 'video') {
    if (!manifest.video) throw new RangeError('A video take needs video timing in its manifest');
    const { startOffsetSec, durationSec } = manifest.video;
    return {
      sampleRate,
      stemFrames: audioFrames,
      outputFrames: Math.max(0, Math.round(durationSec * sampleRate)),
      backingStartFrame: Math.round(startOffsetSec * sampleRate),
      vocalStartFrame: Math.round((startOffsetSec + vocalLatencySec) * sampleRate),
    };
  }

  const vocalStartFrame = Math.round(vocalLatencySec * sampleRate);
  return {
    sampleRate,
    stemFrames: audioFrames,
    outputFrames: Math.max(0, audioFrames - Math.max(0, vocalStartFrame)),
    backingStartFrame: 0,
    vocalStartFrame,
  };
}
