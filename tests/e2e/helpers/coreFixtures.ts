// Songs and audio measurements for the core end-to-end flow. Every file
// is synthesized at test time, so no audio lives in the repository.
//
//   backing    irregular clicks + soft chords + low noise: broadband and never periodic, so
//              cross-correlating an export with it gives one sharp peak.
//   reference  a clear sung-like lead melody (harmonic tones with vibrato and a scoop into each
//              note, centre) over wide chords, PLUS a steady pilot tone at PILOT_HZ that exists
//              nowhere else. The reference is analysis-only: finding the pilot in an export
//              would mean it leaked into the mix. (The analysis tells a voice from an
//              instrument by its moving pitch; a perfectly steady lead counts as an instrument.)
//
// The singer's voice (MIC_HZ) is generated in the page by the spec; nothing in these songs
// sounds near it, so it can be measured in an export.
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const nodeRequire = createRequire(__filename);
const ffmpegPath = nodeRequire('ffmpeg-static') as string;

export const SONG_RATE = 48000;
export const MIC_HZ = 392;
export const PILOT_HZ = 2750;
export const BACKING_SEC = 12;
export const REFERENCE_SEC = 10;

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 16-bit PCM WAV, which the app decodes like any song a singer would load. */
function wavBytes(channels: Float32Array[], sampleRate: number): Buffer {
  const frames = channels[0]?.length ?? 0;
  const blockAlign = channels.length * 2;
  const buffer = Buffer.alloc(44 + frames * blockAlign);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + frames * blockAlign, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels.length, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(frames * blockAlign, 40);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0));
      buffer.writeInt16LE(Math.round(sample * 32767), offset);
      offset += 2;
    }
  }
  return buffer;
}

function addTone(
  target: Float32Array,
  hz: number,
  amplitude: number,
  startSec: number,
  durationSec: number,
  decaySec = Number.POSITIVE_INFINITY,
): void {
  const start = Math.round(startSec * SONG_RATE);
  const end = Math.min(target.length, start + Math.round(durationSec * SONG_RATE));
  const fade = Math.round(0.01 * SONG_RATE);
  for (let frame = Math.max(0, start); frame < end; frame++) {
    const t = (frame - start) / SONG_RATE;
    const edge = Math.min(1, (frame - start) / fade, (end - frame) / fade);
    const envelope = edge * Math.exp(-t / decaySec);
    target[frame] = (target[frame] ?? 0) + amplitude * envelope * Math.sin(2 * Math.PI * hz * t);
  }
}

/** Vibrato and scoop of the sung reference melody. */
const VIBRATO_HZ = 5.5;
const VIBRATO_CENTS = 25;
const SCOOP_CENTS = -60;
const SCOOP_SEC = 0.08;
const VOICE_HARMONICS = [
  [1, 0.22],
  [2, 0.09],
  [3, 0.05],
] as const;

/** One sung note: a few harmonics whose pitch scoops up into the note and then sways. */
function addSungNote(
  targets: Float32Array[],
  hz: number,
  startSec: number,
  durationSec: number,
): void {
  const start = Math.round(startSec * SONG_RATE);
  const length = Math.round(durationSec * SONG_RATE);
  const fade = Math.round(0.01 * SONG_RATE);
  let phase = 0;
  for (let offset = 0; offset < length; offset++) {
    const t = offset / SONG_RATE;
    const scoop = SCOOP_CENTS * Math.max(0, 1 - t / SCOOP_SEC);
    const vibrato = VIBRATO_CENTS * Math.sin(2 * Math.PI * VIBRATO_HZ * t);
    phase += (2 * Math.PI * hz * 2 ** ((scoop + vibrato) / 1200)) / SONG_RATE;
    const edge = Math.min(1, offset / fade, (length - offset) / fade);
    let sample = 0;
    for (const [harmonic, amplitude] of VOICE_HARMONICS) {
      sample += amplitude * Math.sin(harmonic * phase);
    }
    for (const target of targets) {
      const frame = start + offset;
      if (frame < target.length) target[frame] = (target[frame] ?? 0) + edge * sample;
    }
  }
}

const CHORDS_HZ = [
  [220, 261.63, 329.63],
  [174.61, 220, 261.63],
  [261.63, 329.63, 523.25],
  [196, 246.94, 293.66],
];

function backingTrack(): Float32Array[] {
  const next = random(7);
  const left = new Float32Array(BACKING_SEC * SONG_RATE);
  const right = new Float32Array(left.length);
  for (let frame = 0; frame < left.length; frame++) {
    const noise = (next() - 0.5) * 0.12;
    left[frame] = noise;
    right[frame] = noise;
  }
  // Clicks at irregular times, so no lag but the true one lines them all up.
  for (let time = 0.2; time < BACKING_SEC - 0.1; time += 0.25 + next() * 0.4) {
    addTone(left, 1500, 0.35, time, 0.03, 0.01);
    addTone(right, 1500, 0.35, time, 0.03, 0.01);
  }
  // Plucked chords on irregular beats.
  for (let time = 0, bar = 0; time < BACKING_SEC - 0.5; time += 0.6 + next() * 0.5, bar++) {
    for (const hz of CHORDS_HZ[bar % CHORDS_HZ.length] ?? []) {
      addTone(left, hz, 0.05, time, 0.5, 0.2);
      addTone(right, hz, 0.05, time, 0.5, 0.2);
    }
  }
  return [left, right];
}

const MELODY_MIDI = [69, 72, 76, 74, 72, 69, 67, 69, 72, 71, 69, 64];

function referenceSong(): Float32Array[] {
  const left = new Float32Array(REFERENCE_SEC * SONG_RATE);
  const right = new Float32Array(left.length);
  // Wide chords (different notes left and right) so the centred melody stands out.
  for (let bar = 0; bar * 2 < REFERENCE_SEC; bar++) {
    const chord = CHORDS_HZ[bar % CHORDS_HZ.length] ?? [];
    chord.forEach((hz, index) => {
      addTone(index % 2 === 0 ? left : right, hz / 2, 0.05, bar * 2, 2);
    });
  }
  const noteSec = REFERENCE_SEC / MELODY_MIDI.length;
  MELODY_MIDI.forEach((midi, index) => {
    const hz = 440 * 2 ** ((midi - 69) / 12);
    addSungNote([left, right], hz, index * noteSec, noteSec * 0.92);
  });
  addTone(left, PILOT_HZ, 0.08, 0, REFERENCE_SEC);
  addTone(right, PILOT_HZ, 0.08, 0, REFERENCE_SEC);
  return [left, right];
}

export interface CoreSongs {
  folder: string;
  backingPath: string;
  referencePath: string;
  dispose: () => void;
}

export function writeCoreSongs(): CoreSongs {
  const folder = mkdtempSync(join(tmpdir(), 'holo-core-songs-'));
  const backingPath = join(folder, 'Backing Track.wav');
  const referencePath = join(folder, 'Reference Song.wav');
  writeFileSync(backingPath, wavBytes(backingTrack(), SONG_RATE));
  writeFileSync(referencePath, wavBytes(referenceSong(), SONG_RATE));
  return {
    folder,
    backingPath,
    referencePath,
    dispose: () => rmSync(folder, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------------------

/** Decodes the first audio stream of any file to mono floats at `sampleRate`. */
export async function decodeMono(path: string, sampleRate: number): Promise<Float32Array> {
  const { stdout } = await run(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      'f32le',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 },
  );
  const bytes = new Uint8Array(stdout);
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
}

/** Power of one frequency over the whole signal (Goertzel). */
function tonePower(samples: Float32Array, sampleRate: number, hz: number): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * hz) / sampleRate);
  let previous = 0;
  let beforePrevious = 0;
  for (const sample of samples) {
    const current = sample + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = current;
  }
  return (
    (previous ** 2 + beforePrevious ** 2 - coefficient * previous * beforePrevious) / samples.length
  );
}

/** Summed power within ±halfWidthHz of `hz`, in 0.5 Hz steps. */
export function bandPower(
  samples: Float32Array,
  sampleRate: number,
  hz: number,
  halfWidthHz = 4,
): number {
  let total = 0;
  for (let offset = -halfWidthHz; offset <= halfWidthHz; offset += 0.5) {
    total += tonePower(samples, sampleRate, hz + offset);
  }
  return total;
}

/** How far a tone stands above the spectrum just beside it (≈1 when it is absent). */
export function toneProminence(samples: Float32Array, sampleRate: number, hz: number): number {
  const beside =
    (bandPower(samples, sampleRate, hz * 0.94) + bandPower(samples, sampleRate, hz * 1.06)) / 2;
  return bandPower(samples, sampleRate, hz) / Math.max(beside, 1e-20);
}

/**
 * Fourth-order high-pass (two RBJ biquads). Removes the voice before the backing track is
 * looked for, so the comparison is between the backing and what is left of it in the mix.
 */
export function highPass(
  samples: Float32Array,
  sampleRate: number,
  cutoffHz: number,
): Float32Array {
  const omega = (2 * Math.PI * cutoffHz) / sampleRate;
  const alpha = Math.sin(omega) / Math.SQRT2;
  const cos = Math.cos(omega);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let output = samples;
  for (let pass = 0; pass < 2; pass++) {
    const input = output;
    output = new Float32Array(input.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let index = 0; index < input.length; index++) {
      const x0 = input[index]!;
      const y0 = b0 * x0 + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      output[index] = y0;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
  }
  return output;
}

export interface CorrelationPeak {
  /** Lag in seconds: signal[t] lines up with reference[t + lagSec]. */
  lagSec: number;
  /** Normalized correlation at the peak, 0..1. */
  peak: number;
  /** Largest correlation more than 10 ms away from the peak. */
  runnerUp: number;
}

/** Normalized cross-correlation of `signal` against `reference` over a range of lags. */
export function crossCorrelate(
  signal: Float32Array,
  reference: Float32Array,
  sampleRate: number,
  minLagSec: number,
  maxLagSec: number,
): CorrelationPeak {
  const minLag = Math.round(minLagSec * sampleRate);
  const maxLag = Math.round(maxLagSec * sampleRate);
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0;
    let signalEnergy = 0;
    let referenceEnergy = 0;
    const start = Math.max(0, -lag);
    const end = Math.min(signal.length, reference.length - lag);
    for (let index = start; index < end; index++) {
      const a = signal[index]!;
      const b = reference[index + lag]!;
      dot += a * b;
      signalEnergy += a * a;
      referenceEnergy += b * b;
    }
    scores.push(dot / Math.sqrt(Math.max(signalEnergy * referenceEnergy, 1e-20)));
  }
  let best = 0;
  scores.forEach((score, index) => {
    if (score > (scores[best] ?? -Infinity)) best = index;
  });
  const guard = Math.round(0.01 * sampleRate);
  let runnerUp = 0;
  scores.forEach((score, index) => {
    if (Math.abs(index - best) > guard) runnerUp = Math.max(runnerUp, score);
  });
  return { lagSec: (best + minLag) / sampleRate, peak: scores[best] ?? 0, runnerUp };
}

/** Root-mean-square level of a signal. */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}
