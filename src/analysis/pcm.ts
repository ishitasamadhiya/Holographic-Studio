// Small helpers for getting decoded audio into the shape the analysis works on.
import { resample } from './resample';
import type { StereoPcm } from './types';

export function assertValidSampleRate(pcm: StereoPcm): void {
  if (!Number.isFinite(pcm.sampleRate) || pcm.sampleRate <= 0) {
    throw new RangeError(`Invalid sample rate: ${pcm.sampleRate}`);
  }
}

/**
 * Resamples one channel to `targetRate`. Non-finite samples (which a damaged file can decode
 * to) are replaced by silence, so that one bad sample cannot turn the whole analysis into NaN.
 */
export function prepareChannel(
  channel: Float32Array,
  sampleRate: number,
  targetRate: number,
): Float32Array {
  const resampled = resample(channel, sampleRate, targetRate);
  for (let index = 0; index < resampled.length; index++) {
    if (!Number.isFinite(resampled[index]!)) resampled[index] = 0;
  }
  return resampled;
}

/**
 * Decoded audio peaks around 1 (float formats allow a little more). A peak far above this
 * comes from a corrupt or mis-scaled float file, and its power spectra would overflow the
 * analysis' float32 buffers into Infinity and NaN.
 */
const MAX_PLAUSIBLE_PEAK = 1000;

/** Scales the channels (together, keeping their balance) back to a peak of 1 if implausibly loud. */
export function limitImplausibleLevel(channels: readonly Float32Array[]): void {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index++) {
      peak = Math.max(peak, Math.abs(channel[index]!));
    }
  }
  if (peak <= MAX_PLAUSIBLE_PEAK) return;
  const gain = 1 / peak;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index++) channel[index]! *= gain;
  }
}

/** (L+R)/2 over the common length of both channels; the left channel itself for mono. */
export function monoMix(pcm: StereoPcm): Float32Array {
  if (pcm.right === null) return pcm.left;
  const length = Math.min(pcm.left.length, pcm.right.length);
  const mono = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    mono[index] = 0.5 * (pcm.left[index]! + pcm.right[index]!);
  }
  return mono;
}
