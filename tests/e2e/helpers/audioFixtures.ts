// Synthetic audio for the engine tests, and the offline measurements that check what the
// engine recorded. Deliberately independent of the app's own DSP: a bug there must not be
// able to hide itself by also being in the measuring stick.
export const FIXTURE_SAMPLE_RATE = 48000;

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Cents from the equal-tempered note `midi` to `hz`. */
export function centsFrom(hz: number, midi: number): number {
  return 1200 * Math.log2(hz / midiToHz(midi));
}

/** Mono 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate = FIXTURE_SAMPLE_RATE): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0));
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export interface VoiceOptions {
  /** Fundamental frequency of the sung note. */
  f0Hz: number;
  /** The note is held this long, then there is silence for `silenceSec` (the file loops). */
  toneSec: number;
  silenceSec: number;
  /** Peak amplitude. */
  peak: number;
}

/**
 * A steady "sung" vowel: ten harmonics falling off as 1/k, with short raised-cosine edges so
 * the onset and release do not click. Steady pitch (no vibrato) so it can be measured to the cent.
 */
export function synthesizeVoice(options: VoiceOptions): Float32Array {
  const sampleRate = FIXTURE_SAMPLE_RATE;
  const toneFrames = Math.round(options.toneSec * sampleRate);
  const total = toneFrames + Math.round(options.silenceSec * sampleRate);
  const fadeFrames = Math.round(0.01 * sampleRate);
  const samples = new Float32Array(total);
  let peak = 0;
  for (let n = 0; n < toneFrames; n++) {
    let value = 0;
    for (let k = 1; k <= 10; k++) {
      value += Math.sin((2 * Math.PI * k * options.f0Hz * n) / sampleRate) / k;
    }
    const edge = Math.min(n, toneFrames - 1 - n);
    if (edge < fadeFrames) value *= 0.5 - 0.5 * Math.cos((Math.PI * edge) / fadeFrames);
    samples[n] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  for (let n = 0; n < toneFrames; n++) samples[n] = ((samples[n] ?? 0) * options.peak) / peak;
  return samples;
}

export function float32FromBase64(base64: string): Float32Array {
  const bytes = Buffer.from(base64, 'base64');
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

export function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  const end = Math.min(to, samples.length);
  for (let i = from; i < end; i++) sum += (samples[i] ?? 0) ** 2;
  return end > from ? Math.sqrt(sum / (end - from)) : 0;
}

export function toDb(level: number): number {
  return 20 * Math.log10(Math.max(level, 1e-12));
}

export interface Run {
  start: number;
  end: number;
}

/**
 * Stretches where the signal is "on": 10 ms windows whose RMS is within `belowPeakDb` of the
 * loudest window. Runs touching either end of the recording are reported as they are.
 */
export function loudRuns(samples: Float32Array, belowPeakDb = 20, windowFrames = 480): Run[] {
  const levels: number[] = [];
  for (let start = 0; start + windowFrames <= samples.length; start += windowFrames) {
    levels.push(rms(samples, start, start + windowFrames));
  }
  const threshold = Math.max(...levels) * 10 ** (-belowPeakDb / 20);
  const runs: Run[] = [];
  let runStart = -1;
  levels.forEach((level, index) => {
    if (level >= threshold && runStart < 0) runStart = index;
    if (level < threshold && runStart >= 0) {
      runs.push({ start: runStart * windowFrames, end: index * windowFrames });
      runStart = -1;
    }
  });
  if (runStart >= 0)
    runs.push({ start: runStart * windowFrames, end: levels.length * windowFrames });
  return runs;
}

export function longestRun(runs: readonly Run[]): Run {
  const best = [...runs].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  if (best === undefined) throw new Error('The recording contains no sound');
  return best;
}

/**
 * Fundamental frequency of one window by the normalized squared-difference function (the
 * first lag whose NSDF peak reaches 90 % of the best one, refined by parabolic interpolation).
 */
export function pitchOfWindow(
  samples: Float32Array,
  from: number,
  length: number,
  sampleRate = FIXTURE_SAMPLE_RATE,
): number {
  const minLag = Math.floor(sampleRate / 1000);
  const maxLag = Math.ceil(sampleRate / 70);
  const nsdf = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let acf = 0;
    let energy = 0;
    for (let i = from; i < from + length - lag; i++) {
      const a = samples[i] ?? 0;
      const b = samples[i + lag] ?? 0;
      acf += a * b;
      energy += a * a + b * b;
    }
    nsdf[lag] = energy > 0 ? (2 * acf) / energy : 0;
  }
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) best = Math.max(best, nsdf[lag] ?? 0);
  for (let lag = minLag; lag <= maxLag; lag++) {
    const value = nsdf[lag] ?? 0;
    if (value >= 0.9 * best && value >= (nsdf[lag - 1] ?? 0) && value >= (nsdf[lag + 1] ?? 0)) {
      const left = nsdf[lag - 1] ?? 0;
      const right = nsdf[lag + 1] ?? 0;
      const curvature = left - 2 * value + right;
      const shift = curvature !== 0 ? (0.5 * (left - right)) / curvature : 0;
      return sampleRate / (lag + shift);
    }
  }
  return Number.NaN;
}

/** Median pitch over 40 ms windows (hop 20 ms) across the range. */
export function medianPitchHz(samples: Float32Array, from: number, to: number): number {
  const windowFrames = 1920;
  const estimates: number[] = [];
  for (let start = from; start + windowFrames <= to; start += windowFrames / 2) {
    const hz = pitchOfWindow(samples, start, windowFrames);
    if (Number.isFinite(hz)) estimates.push(hz);
  }
  estimates.sort((a, b) => a - b);
  return estimates[estimates.length >> 1] ?? Number.NaN;
}

/** Positions of isolated impulses at or above `threshold` (single-sample clicks). */
export function findImpulses(samples: Float32Array, threshold: number): number[] {
  const positions: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i] ?? 0);
    if (value < threshold) continue;
    const previous = positions.at(-1);
    if (previous !== undefined && i - previous < 64) {
      if (value > Math.abs(samples[previous] ?? 0)) positions[positions.length - 1] = i;
      continue;
    }
    positions.push(i);
  }
  return positions;
}
