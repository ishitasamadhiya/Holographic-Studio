// Helpers shared by the mixdown tests: synthetic stems in, parsed WAV out.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STEM_CHANNELS, type TakeManifest } from '@shared/take';

export const TEST_SAMPLE_RATE = 48000;

export async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'holo-mix-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function silentStem(frames: number): Float32Array {
  return new Float32Array(frames * STEM_CHANNELS);
}

/** Interleaved stereo sine with the same signal in both channels. */
export function stereoSine(
  frames: number,
  frequencyHz: number,
  amplitude: number,
  sampleRate = TEST_SAMPLE_RATE,
): Float32Array {
  const samples = new Float32Array(frames * STEM_CHANNELS);
  for (let frame = 0; frame < frames; frame++) {
    const value = amplitude * Math.sin((2 * Math.PI * frequencyHz * frame) / sampleRate);
    samples[frame * STEM_CHANNELS] = value;
    samples[frame * STEM_CHANNELS + 1] = value;
  }
  return samples;
}

export async function writeStem(path: string, samples: Float32Array): Promise<void> {
  await writeFile(path, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
}

export interface StemFiles {
  vocalPath: string;
  backingPath: string;
}

export async function writeStems(
  dir: string,
  vocal: Float32Array,
  backing: Float32Array,
): Promise<StemFiles> {
  const vocalPath = join(dir, 'vocal.f32');
  const backingPath = join(dir, 'backing.f32');
  await writeStem(vocalPath, vocal);
  await writeStem(backingPath, backing);
  return { vocalPath, backingPath };
}

export function audioManifest(audioFrames: number, vocalLatencySec = 0): TakeManifest {
  return {
    mode: 'audio',
    sampleRate: TEST_SAMPLE_RATE,
    audioFrames,
    vocalLatencySec,
    hasBacking: true,
  };
}

export function videoManifest(
  audioFrames: number,
  vocalLatencySec: number,
  startOffsetSec: number,
  durationSec: number,
): TakeManifest {
  return {
    mode: 'video',
    sampleRate: TEST_SAMPLE_RATE,
    audioFrames,
    vocalLatencySec,
    hasBacking: true,
    video: { startOffsetSec, durationSec, width: 1280, height: 720, frameRate: 30 },
  };
}

export interface ParsedWav {
  riffSize: number;
  formatTag: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  factFrames: number;
  dataBytes: number;
  fileBytes: number;
  /** Interleaved samples. */
  samples: Float32Array;
}

/** Walks the RIFF chunks of a float WAV file written by WavWriter. */
export async function readFloatWav(path: string): Promise<ParsedWav> {
  const file = await readFile(path);
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file');
  }
  const parsed: Partial<ParsedWav> = { riffSize: file.readUInt32LE(4), fileBytes: file.length };
  let offset = 12;
  while (offset + 8 <= file.length) {
    const id = file.toString('ascii', offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      parsed.formatTag = file.readUInt16LE(body);
      parsed.channels = file.readUInt16LE(body + 2);
      parsed.sampleRate = file.readUInt32LE(body + 4);
      parsed.byteRate = file.readUInt32LE(body + 8);
      parsed.blockAlign = file.readUInt16LE(body + 12);
      parsed.bitsPerSample = file.readUInt16LE(body + 14);
    } else if (id === 'fact') {
      parsed.factFrames = file.readUInt32LE(body);
    } else if (id === 'data') {
      parsed.dataBytes = size;
      const bytes = file.subarray(body, body + size);
      parsed.samples = new Float32Array(new Uint8Array(bytes).buffer);
    }
    offset = body + size + (size % 2);
  }
  return parsed as ParsedWav;
}

/** Largest absolute sample value. */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}
