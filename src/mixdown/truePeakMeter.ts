import { STEM_CHANNELS } from '@shared/take';

// The real waveform can swing higher between two samples than either sample shows.
// This meter estimates those inter-sample peaks by evaluating the band-limited
// interpolation at the three quarter-points between neighbouring samples (4x oversampling,
// as in ITU-R BS.1770 Annex 2) with a short windowed-sinc kernel.
const TAPS = 12;
const HALF_TAPS = TAPS / 2;
const QUARTER_POINTS = [0.25, 0.5, 0.75];
const HISTORY_FRAMES = TAPS - 1;
// A module-local copy: imported bindings are slow to read inside per-sample loops under
// the test runner's module transform.
const CHANNELS = STEM_CHANNELS;

/**
 * Interpolation only runs where a new maximum is plausible: next to samples above half of
 * the peak found so far. Inter-sample overshoot of real audio stays far below that 6 dB
 * margin, and skipping the rest makes the meter almost free on long takes.
 */
const CANDIDATE_RATIO = 0.5;

function sinc(x: number): number {
  if (x === 0) return 1;
  const angle = Math.PI * x;
  return Math.sin(angle) / angle;
}

/** Kernel that evaluates the waveform `fraction` of the way from sample 0 to sample 1. */
function interpolationKernel(fraction: number): Float64Array {
  const kernel = new Float64Array(TAPS);
  let sum = 0;
  for (let tap = 0; tap < TAPS; tap++) {
    const distance = tap - (HALF_TAPS - 1) - fraction;
    const hannWindow = 0.5 * (1 + Math.cos((Math.PI * distance) / HALF_TAPS));
    kernel[tap] = sinc(distance) * hannWindow;
    sum += kernel[tap]!;
  }
  // Unity gain at DC, so a constant signal interpolates to itself.
  for (let tap = 0; tap < TAPS; tap++) kernel[tap] = kernel[tap]! / sum;
  return kernel;
}

/** The three kernels back to back; a flat array keeps the inner loop fast. */
const KERNELS = new Float64Array(QUARTER_POINTS.length * TAPS);
QUARTER_POINTS.forEach((fraction, index) => {
  KERNELS.set(interpolationKernel(fraction), index * TAPS);
});

/** Streaming true-peak estimate for interleaved stereo audio. */
export class TruePeakMeter {
  private work = new Float32Array(HISTORY_FRAMES * CHANNELS);
  private peak = 0;

  process(interleaved: Float32Array, frameCount: number): void {
    const historySamples = HISTORY_FRAMES * CHANNELS;
    const newSamples = frameCount * CHANNELS;
    if (this.work.length < historySamples + newSamples) {
      const grown = new Float32Array(historySamples + newSamples);
      grown.set(this.work.subarray(0, historySamples));
      this.work = grown;
    }
    const work = this.work;
    work.set(interleaved.subarray(0, newSamples), historySamples);

    let peak = this.peak;
    for (let index = historySamples; index < historySamples + newSamples; index++) {
      const magnitude = Math.abs(work[index]!);
      if (magnitude > peak) peak = magnitude;

      // The newest sample completes the kernel centred between the samples that are
      // HALF_TAPS and HALF_TAPS - 1 frames older.
      const leftIndex = index - HALF_TAPS * CHANNELS;
      const threshold = peak * CANDIDATE_RATIO;
      if (
        Math.abs(work[leftIndex]!) < threshold &&
        Math.abs(work[leftIndex + CHANNELS]!) < threshold
      ) {
        continue;
      }
      const oldestIndex = index - HISTORY_FRAMES * CHANNELS;
      for (let kernelStart = 0; kernelStart < KERNELS.length; kernelStart += TAPS) {
        let value = 0;
        for (let tap = 0; tap < TAPS; tap++) {
          value += KERNELS[kernelStart + tap]! * work[oldestIndex + tap * CHANNELS]!;
        }
        const interpolated = Math.abs(value);
        if (interpolated > peak) peak = interpolated;
      }
    }
    this.peak = peak;

    // Keep the newest frames as history for the next block.
    work.copyWithin(0, newSamples, newSamples + historySamples);
  }

  /** Largest magnitude seen so far, as a linear amplitude (0 for digital silence). */
  truePeak(): number {
    return this.peak;
  }
}
