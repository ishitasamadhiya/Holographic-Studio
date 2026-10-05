import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFloatWav, withTempDir } from './testSupport';
import { buildFloatWavHeader, FLOAT_WAV_HEADER_BYTES, WavWriter } from './wavWriter';

describe('buildFloatWavHeader', () => {
  it('lays out a canonical 32-bit float WAV header', () => {
    const header = buildFloatWavHeader({ sampleRate: 48000, channels: 2, frameCount: 1000 });
    expect(header.length).toBe(FLOAT_WAV_HEADER_BYTES);
    expect(header.toString('ascii', 0, 4)).toBe('RIFF');
    expect(header.readUInt32LE(4)).toBe(FLOAT_WAV_HEADER_BYTES - 8 + 8000);
    expect(header.toString('ascii', 8, 12)).toBe('WAVE');
    expect(header.toString('ascii', 12, 16)).toBe('fmt ');
    expect(header.readUInt32LE(16)).toBe(18);
    expect(header.readUInt16LE(20)).toBe(3);
    expect(header.readUInt16LE(22)).toBe(2);
    expect(header.readUInt32LE(24)).toBe(48000);
    expect(header.readUInt32LE(28)).toBe(48000 * 8);
    expect(header.readUInt16LE(32)).toBe(8);
    expect(header.readUInt16LE(34)).toBe(32);
    expect(header.readUInt16LE(36)).toBe(0);
    expect(header.toString('ascii', 38, 42)).toBe('fact');
    expect(header.readUInt32LE(42)).toBe(4);
    expect(header.readUInt32LE(46)).toBe(1000);
    expect(header.toString('ascii', 50, 54)).toBe('data');
    expect(header.readUInt32LE(54)).toBe(8000);
  });

  it('refuses audio that cannot fit in a RIFF file', () => {
    const tooManyFrames = Math.ceil(0xffffffff / 8) + 1;
    expect(() =>
      buildFloatWavHeader({ sampleRate: 48000, channels: 2, frameCount: tooManyFrames }),
    ).toThrow(RangeError);
  });
});

describe('WavWriter', () => {
  it('writes blocks back-to-back and the file reads back sample for sample', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'out.wav');
      const samples = Float32Array.from({ length: 600 }, (_, index) => Math.sin(index) * 0.5);
      const writer = await WavWriter.create(path, {
        sampleRate: 44100,
        channels: 2,
        frameCount: 300,
      });
      await writer.write(samples.subarray(0, 200), 100);
      await writer.write(samples.subarray(200, 200), 0);
      await writer.write(samples.subarray(200), 200);
      await writer.close();

      const wav = await readFloatWav(path);
      expect(wav.fileBytes).toBe(FLOAT_WAV_HEADER_BYTES + 2400);
      expect(wav.riffSize).toBe(wav.fileBytes - 8);
      expect(wav.sampleRate).toBe(44100);
      expect(wav.dataBytes).toBe(2400);
      expect(wav.factFrames).toBe(300);
      expect(wav.samples).toEqual(samples);
    });
  });

  it('writes only the requested frames of a larger buffer', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'out.wav');
      const buffer = new Float32Array(64).fill(0.25);
      const writer = await WavWriter.create(path, {
        sampleRate: 48000,
        channels: 2,
        frameCount: 4,
      });
      await writer.write(buffer, 4);
      await writer.close();
      expect((await readFloatWav(path)).samples).toEqual(new Float32Array(8).fill(0.25));
    });
  });

  it('refuses to finish a file whose audio does not match its header, and removes it', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'short.wav');
      const writer = await WavWriter.create(path, {
        sampleRate: 48000,
        channels: 2,
        frameCount: 10,
      });
      await writer.write(new Float32Array(8), 4);
      await expect(writer.close()).rejects.toThrow(/incomplete/);
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('abort() deletes the unfinished file', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'aborted.wav');
      const writer = await WavWriter.create(path, {
        sampleRate: 48000,
        channels: 2,
        frameCount: 10,
      });
      await writer.write(new Float32Array(8), 4);
      await writer.abort();
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });
});
