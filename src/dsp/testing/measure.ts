// Offline measurements used by the DSP tests. Independent of the code under test: pitch is
// measured with a long-window normalized autocorrelation at the full sample rate.

export interface PitchMeasurement {
  hz: number;
  /** 0..1: how exactly the segment repeats at that pitch (1 = perfectly periodic). */
  periodicity: number;
}

// Ranges are [start, end) in samples. Bounds are rounded and clipped to the signal, so
// callers can pass seconds × sampleRate without worrying about floating-point fractions.

export function rms(signal: Float32Array, start = 0, end = signal.length): number {
  const first = firstIndex(start);
  const last = lastIndex(signal, end);
  let sum = 0;
  for (let n = first; n < last; n++) sum += signal[n]! * signal[n]!;
  return Math.sqrt(sum / Math.max(1, last - first));
}

export function peak(signal: Float32Array, start = 0, end = signal.length): number {
  const last = lastIndex(signal, end);
  let largest = 0;
  for (let n = firstIndex(start); n < last; n++) largest = Math.max(largest, Math.abs(signal[n]!));
  return largest;
}

/** Largest jump between two consecutive samples: a click shows up here as an outlier. */
export function maxStep(signal: Float32Array, start = 0, end = signal.length): number {
  const last = lastIndex(signal, end);
  let largest = 0;
  for (let n = Math.max(1, firstIndex(start)); n < last; n++) {
    largest = Math.max(largest, Math.abs(signal[n]! - signal[n - 1]!));
  }
  return largest;
}

/**
 * Largest second difference |x[n+1] − 2x[n] + x[n−1]|: the "kink" a hard splice leaves even
 * where two waveforms happen to meet at the same value. Scales with frequency squared, so a
 * signal transposed by a ratio r has r² times the curvature of the original.
 */
export function maxSecondDifference(signal: Float32Array, start = 0, end = signal.length): number {
  const last = lastIndex(signal, end) - 1;
  let largest = 0;
  for (let n = Math.max(1, firstIndex(start)); n < last; n++) {
    largest = Math.max(largest, Math.abs(signal[n + 1]! - 2 * signal[n]! + signal[n - 1]!));
  }
  return largest;
}

function firstIndex(start: number): number {
  return Math.max(0, Math.round(start));
}

function lastIndex(signal: Float32Array, end: number): number {
  return Math.min(signal.length, Math.round(end));
}

/**
 * Index of the first sample at which two signals differ, or -1 when they are identical.
 * (Comparing long buffers with a deep-equality matcher is very slow, and slower still when
 * it has to describe a mismatch.)
 */
export function firstDifference(actual: Float32Array, expected: Float32Array): number {
  const length = Math.min(actual.length, expected.length);
  for (let n = 0; n < length; n++) {
    if (actual[n] !== expected[n]) return n;
  }
  return actual.length === expected.length ? -1 : length;
}

/**
 * Like firstDifference, for a signal that should be `input` delayed by `delay` samples:
 * returns the first index at or after `from` where `output[n] !== input[n - delay]`, or -1.
 */
export function firstDelayedDifference(
  output: Float32Array,
  input: Float32Array,
  delay: number,
  from = 0,
): number {
  for (let n = Math.max(from, delay); n < output.length; n++) {
    if (output[n] !== input[n - delay]) return n;
  }
  return -1;
}

export function centsBetween(hz: number, referenceHz: number): number {
  return 1200 * Math.log2(hz / referenceHz);
}

export function mean(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / Math.max(1, values.length);
}

export function standardDeviation(values: readonly number[]): number {
  const average = mean(values);
  let sum = 0;
  for (const value of values) sum += (value - average) * (value - average);
  return Math.sqrt(sum / Math.max(1, values.length));
}

/**
 * Measures the pitch of `signal[start .. start + windowSamples)` by finding the lag, within
 * `searchCents` of the expected period, at which the segment best matches itself.
 */
export function measurePitch(
  signal: Float32Array,
  sampleRate: number,
  start: number,
  windowSamples: number,
  expectedHz: number,
  searchCents = 200,
): PitchMeasurement {
  const span = 2 ** (searchCents / 1200);
  const firstLag = Math.max(2, Math.floor(sampleRate / (expectedHz * span)) - 1);
  const lastLag = Math.ceil((sampleRate / expectedHz) * span) + 1;
  const scores: number[] = [];
  let best = 0;
  for (let lag = firstLag; lag <= lastLag; lag++) {
    let correlation = 0;
    let energy = 0;
    for (let n = start; n < start + windowSamples; n++) {
      const a = signal[n]!;
      const b = signal[n + lag]!;
      correlation += a * b;
      energy += a * a + b * b;
    }
    scores.push(energy > 0 ? (2 * correlation) / energy : 0);
    if (scores[scores.length - 1]! > scores[best]!) best = scores.length - 1;
  }
  let offset = 0;
  let periodicity = scores[best]!;
  if (best > 0 && best < scores.length - 1) {
    const left = scores[best - 1]!;
    const right = scores[best + 1]!;
    const curvature = left - 2 * periodicity + right;
    if (curvature < 0) {
      offset = (0.5 * (left - right)) / curvature;
      periodicity -= 0.25 * (left - right) * offset;
    }
  }
  return { hz: sampleRate / (firstLag + best + offset), periodicity };
}

export interface PitchTrackOptions {
  sampleRate: number;
  startSec: number;
  endSec: number;
  /** Pitch the track is expressed relative to, and around which it is searched. */
  referenceHz: number;
  /** Analysis window; about three periods resolves vibrato well. */
  windowSec: number;
  hopSec?: number;
  searchCents?: number;
}

/** Pitch over time, in cents relative to `referenceHz`, one value per hop. */
export function trackPitchCents(signal: Float32Array, options: PitchTrackOptions): number[] {
  const { sampleRate, referenceHz } = options;
  const hop = Math.round((options.hopSec ?? 0.005) * sampleRate);
  const windowSamples = Math.round(options.windowSec * sampleRate);
  const longestLag =
    Math.ceil((sampleRate / referenceHz) * 2 ** ((options.searchCents ?? 200) / 1200)) + 2;
  const end = Math.min(
    Math.round(options.endSec * sampleRate),
    signal.length - windowSamples - longestLag,
  );
  const track: number[] = [];
  for (let start = Math.round(options.startSec * sampleRate); start < end; start += hop) {
    const measured = measurePitch(
      signal,
      sampleRate,
      start,
      windowSamples,
      referenceHz,
      options.searchCents,
    );
    track.push(centsBetween(measured.hz, referenceHz));
  }
  return track;
}
