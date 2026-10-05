import { appendFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TakeManifest } from '@shared/take';
import { dbToGain } from './decibels';
import { LoudnessMeter } from './loudnessMeter';
import {
  chooseGainDb,
  MAX_BOOST_DB,
  mixTake,
  PEAK_CEILING_DBFS,
  TARGET_LOUDNESS_LUFS,
  type MixResult,
} from './mixTake';
import {
  audioManifest,
  peakOf,
  readFloatWav,
  silentStem,
  stereoSine,
  TEST_SAMPLE_RATE,
  videoManifest,
  withTempDir,
  writeStems,
  type ParsedWav,
} from './testSupport';
import { FLOAT_WAV_HEADER_BYTES } from './wavWriter';

const CEILING = dbToGain(PEAK_CEILING_DBFS);

interface Rendered {
  result: MixResult;
  wav: ParsedWav;
}

async function render(
  vocal: Float32Array,
  backing: Float32Array,
  manifest: TakeManifest,
): Promise<Rendered> {
  return withTempDir(async (dir) => {
    const stems = await writeStems(dir, vocal, backing);
    const outputWavPath = join(dir, 'mix.wav');
    const result = await mixTake({ ...stems, manifest, outputWavPath });
    return { result, wav: await readFloatWav(outputWavPath) };
  });
}

function loudnessOf(samples: Float32Array): number {
  const meter = new LoudnessMeter(TEST_SAMPLE_RATE);
  meter.process(samples, samples.length / 2);
  return meter.integratedLufs();
}

function nonZeroFrames(interleaved: Float32Array): number[] {
  const frames: number[] = [];
  for (let frame = 0; frame < interleaved.length / 2; frame++) {
    if (interleaved[frame * 2] !== 0 || interleaved[frame * 2 + 1] !== 0) frames.push(frame);
  }
  return frames;
}

const FIVE_SECONDS = TEST_SAMPLE_RATE * 5;

describe('chooseGainDb', () => {
  it('moves the mix to the target loudness', () => {
    expect(chooseGainDb(-20)).toBeCloseTo(6);
    expect(chooseGainDb(-9)).toBeCloseTo(-5);
    expect(chooseGainDb(TARGET_LOUDNESS_LUFS)).toBeCloseTo(0);
  });

  it('caps the boost and the cut, and leaves silence alone', () => {
    expect(chooseGainDb(-60)).toBe(MAX_BOOST_DB);
    expect(chooseGainDb(30)).toBe(-24);
    expect(chooseGainDb(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('mixTake', () => {
  it('writes a float WAV whose header matches the audio', async () => {
    const tone = stereoSine(FIVE_SECONDS, 440, 0.1);
    const { result, wav } = await render(
      tone,
      silentStem(FIVE_SECONDS),
      audioManifest(FIVE_SECONDS),
    );
    expect(wav.formatTag).toBe(3);
    expect(wav.channels).toBe(2);
    expect(wav.sampleRate).toBe(TEST_SAMPLE_RATE);
    expect(wav.bitsPerSample).toBe(32);
    expect(wav.blockAlign).toBe(8);
    expect(wav.byteRate).toBe(TEST_SAMPLE_RATE * 8);
    expect(wav.factFrames).toBe(FIVE_SECONDS);
    expect(wav.dataBytes).toBe(FIVE_SECONDS * 8);
    expect(wav.fileBytes).toBe(FLOAT_WAV_HEADER_BYTES + FIVE_SECONDS * 8);
    expect(wav.riffSize).toBe(wav.fileBytes - 8);
    expect(result.outputFrames).toBe(FIVE_SECONDS);
    expect(result.durationSec).toBe(5);
    expect(result.sampleRate).toBe(TEST_SAMPLE_RATE);
  });

  it('keeps the take sample rate (44.1 kHz in, 44.1 kHz out)', async () => {
    const frames = 44100 * 2;
    const manifest = { ...audioManifest(frames), sampleRate: 44100 };
    const { wav, result } = await render(
      stereoSine(frames, 440, 0.1, 44100),
      silentStem(frames),
      manifest,
    );
    expect(wav.sampleRate).toBe(44100);
    expect(result.durationSec).toBe(2);
  });

  it('brings a quiet mix up to -14 LUFS', async () => {
    // -20 dBFS stereo 1 kHz sine = -20 LUFS; +6 dB puts its peak at -14 dBFS, far below the limiter.
    const tone = stereoSine(FIVE_SECONDS, 1000, dbToGain(-20));
    const { result, wav } = await render(
      tone,
      silentStem(FIVE_SECONDS),
      audioManifest(FIVE_SECONDS),
    );
    expect(result.measuredLufs).toBeCloseTo(-20, 1);
    expect(result.gainDb).toBeCloseTo(6, 1);
    expect(Math.abs(loudnessOf(wav.samples) - TARGET_LOUDNESS_LUFS)).toBeLessThan(0.5);
    expect(result.outputPeakDbfs).toBeCloseTo(-14, 1);
  });

  it('turns a hot mix down to -14 LUFS', async () => {
    // Vocal and backing in phase: 0.25 + 0.25 = -6 dBFS = -6 LUFS.
    const tone = stereoSine(FIVE_SECONDS, 1000, 0.25);
    const { result, wav } = await render(tone, tone, audioManifest(FIVE_SECONDS));
    expect(result.measuredLufs).toBeCloseTo(-6.02, 1);
    expect(result.gainDb).toBeCloseTo(-7.98, 1);
    expect(Math.abs(loudnessOf(wav.samples) - TARGET_LOUDNESS_LUFS)).toBeLessThan(0.5);
  });

  it('boosts a very quiet take by at most 12 dB', async () => {
    const tone = stereoSine(FIVE_SECONDS, 1000, dbToGain(-40));
    const { result, wav } = await render(
      tone,
      silentStem(FIVE_SECONDS),
      audioManifest(FIVE_SECONDS),
    );
    expect(result.gainDb).toBe(MAX_BOOST_DB);
    expect(loudnessOf(wav.samples)).toBeCloseTo(-28, 0);
  });

  it('never exceeds the -1 dBFS ceiling, even when both stems are clipping hot', async () => {
    // Quiet most of the time (so the gain goes up), with short spikes far over full scale.
    const vocal = stereoSine(FIVE_SECONDS, 700, 0.02);
    const backing = stereoSine(FIVE_SECONDS, 90, 0.02);
    for (let frame = 0; frame < FIVE_SECONDS; frame++) {
      if (frame % 24_000 < 20) {
        vocal[frame * 2] = 1.5;
        vocal[frame * 2 + 1] = -1.5;
        backing[frame * 2] = 1.0;
        backing[frame * 2 + 1] = -1.0;
      }
    }
    const { result, wav } = await render(vocal, backing, audioManifest(FIVE_SECONDS));
    expect(result.gainDb).toBeGreaterThan(0);
    expect(result.truePeakDbfs).toBeGreaterThan(7.9);
    expect(peakOf(wav.samples)).toBeLessThanOrEqual(CEILING);
    expect(peakOf(wav.samples)).toBeGreaterThan(CEILING * 0.95);
    expect(result.outputPeakDbfs).toBeLessThanOrEqual(PEAK_CEILING_DBFS);
  });

  it('keeps silence silent', async () => {
    const { result, wav } = await render(
      silentStem(FIVE_SECONDS),
      silentStem(FIVE_SECONDS),
      audioManifest(FIVE_SECONDS),
    );
    expect(result.measuredLufs).toBe(Number.NEGATIVE_INFINITY);
    expect(result.gainDb).toBe(0);
    expect(wav.samples.length).toBe(FIVE_SECONDS * 2);
    expect(peakOf(wav.samples)).toBe(0);
  });

  it('writes only finite samples when the stems add up to more than a float can hold', async () => {
    // Both stems hold a huge (but valid) sample on the same frame: the sum overflows float32.
    const vocal = stereoSine(FIVE_SECONDS, 1000, dbToGain(-26));
    const backing = stereoSine(FIVE_SECONDS, 1000, dbToGain(-26));
    vocal[100_000 * 2] = 3e38;
    backing[100_000 * 2] = 3e38;

    const { result, wav } = await render(vocal, backing, audioManifest(FIVE_SECONDS));

    expect(wav.samples.every((sample) => Number.isFinite(sample))).toBe(true);
    expect(peakOf(wav.samples)).toBeLessThanOrEqual(CEILING);
    // The bad sample was dropped, so the rest of the take is still measured and normalised.
    expect(result.measuredLufs).toBeCloseTo(-20, 1);
    expect(result.gainDb).toBeCloseTo(6, 1);
    expect(Number.isFinite(result.truePeakDbfs)).toBe(true);
    expect(Math.abs(loudnessOf(wav.samples) - TARGET_LOUDNESS_LUFS)).toBeLessThan(0.5);
  });

  it('writes only finite samples when the loudness gain pushes a spike past what a float can hold', async () => {
    // The spike sits in the last few milliseconds, after the final loudness block, so the
    // quiet take around it is still boosted — and 2e38 times that boost overflows float32.
    const frames = FIVE_SECONDS + 3000;
    const vocal = stereoSine(frames, 1000, dbToGain(-20));
    vocal[(FIVE_SECONDS + 1500) * 2] = 2e38;

    const { result, wav } = await render(vocal, silentStem(frames), audioManifest(frames));

    expect(result.gainDb).toBeGreaterThan(5);
    expect(wav.samples.every((sample) => Number.isFinite(sample))).toBe(true);
    expect(peakOf(wav.samples)).toBeLessThanOrEqual(CEILING);
  });

  it('puts a late vocal impulse on the backing impulse in the finished file (audio only)', async () => {
    const latencySec = 0.03;
    const latencyFrames = latencySec * TEST_SAMPLE_RATE;
    const vocal = silentStem(FIVE_SECONDS);
    const backing = silentStem(FIVE_SECONDS);
    backing[100_000 * 2 + 1] = 0.25;
    vocal[(100_000 + latencyFrames) * 2] = 0.5;

    const { wav, result } = await render(vocal, backing, audioManifest(FIVE_SECONDS, latencySec));
    expect(result.outputFrames).toBe(FIVE_SECONDS - latencyFrames);
    expect(nonZeroFrames(wav.samples)).toEqual([100_000]);
    // Both impulses got the same gain, so their 2:1 ratio survives.
    expect(wav.samples[100_000 * 2]! / wav.samples[100_000 * 2 + 1]!).toBeCloseTo(2, 5);
  });

  it.each([
    ['after', 0.4],
    ['before', -0.4],
  ])(
    'lines both impulses up with a video that started %s the audio',
    async (_when, startOffsetSec) => {
      const latencySec = 0.021;
      const latencyFrames = Math.round(latencySec * TEST_SAMPLE_RATE);
      const vocal = silentStem(FIVE_SECONDS);
      const backing = silentStem(FIVE_SECONDS);
      backing[96_000 * 2 + 1] = 0.25;
      vocal[(96_000 + latencyFrames) * 2] = 0.5;

      const manifest = videoManifest(FIVE_SECONDS, latencySec, startOffsetSec, 4);
      const { wav, result } = await render(vocal, backing, manifest);
      expect(result.outputFrames).toBe(4 * TEST_SAMPLE_RATE);
      expect(wav.samples.length).toBe(4 * TEST_SAMPLE_RATE * 2);
      expect(nonZeroFrames(wav.samples)).toEqual([
        96_000 - Math.round(startOffsetSec * TEST_SAMPLE_RATE),
      ]);
    },
  );

  it('fades the first and last few milliseconds so a take that starts mid-note does not click', async () => {
    const constant = new Float32Array(FIVE_SECONDS * 2).fill(0.2);
    const { wav } = await render(constant, silentStem(FIVE_SECONDS), audioManifest(FIVE_SECONDS));
    const last = wav.samples.length - 1;
    expect(wav.samples[0]).toBe(0);
    expect(wav.samples[last]).toBe(0);
    expect(Math.abs(wav.samples[2 * 120]!)).toBeGreaterThan(0);
    expect(Math.abs(wav.samples[2 * 120]!)).toBeLessThan(Math.abs(wav.samples[2 * 2400]!));
    expect(Math.abs(wav.samples[last - 2 * 120]!)).toBeLessThan(Math.abs(wav.samples[2 * 2400]!));
  });

  it('reports progress that only moves forward and ends at 1', async () => {
    await withTempDir(async (dir) => {
      const frames = TEST_SAMPLE_RATE * 3;
      const stems = await writeStems(dir, stereoSine(frames, 440, 0.1), silentStem(frames));
      const fractions: number[] = [];
      await mixTake({
        ...stems,
        manifest: audioManifest(frames),
        outputWavPath: join(dir, 'mix.wav'),
        onProgress: (fraction) => fractions.push(fraction),
      });
      expect(fractions.length).toBeGreaterThan(4);
      expect(fractions.at(-1)).toBe(1);
      expect(fractions[0]!).toBeGreaterThan(0);
      for (let index = 1; index < fractions.length; index++) {
        expect(fractions[index]!).toBeGreaterThan(fractions[index - 1]!);
      }
    });
  });

  it('stops when cancelled and leaves no half-written WAV behind', async () => {
    await withTempDir(async (dir) => {
      const frames = TEST_SAMPLE_RATE * 4;
      const stems = await writeStems(dir, stereoSine(frames, 440, 0.1), silentStem(frames));
      const outputWavPath = join(dir, 'mix.wav');
      const controller = new AbortController();
      const fractions: number[] = [];

      const mixing = mixTake({
        ...stems,
        manifest: audioManifest(frames),
        outputWavPath,
        signal: controller.signal,
        onProgress: (fraction) => {
          fractions.push(fraction);
          // Cancel during the rendering pass, when the WAV already exists on disk.
          if (fraction > 0.7) controller.abort();
        },
      });

      await expect(mixing).rejects.toMatchObject({ name: 'AbortError' });
      expect(fractions.at(-1)!).toBeLessThan(1);
      await expect(stat(outputWavPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('does nothing when the signal is already aborted', async () => {
    await withTempDir(async (dir) => {
      const stems = await writeStems(dir, silentStem(1000), silentStem(1000));
      const outputWavPath = join(dir, 'mix.wav');
      await expect(
        mixTake({
          ...stems,
          manifest: audioManifest(1000),
          outputWavPath,
          signal: AbortSignal.abort(),
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      await expect(stat(outputWavPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('fails cleanly when a stem file is missing', async () => {
    await withTempDir(async (dir) => {
      const stems = await writeStems(dir, silentStem(1000), silentStem(1000));
      await expect(
        mixTake({
          vocalPath: stems.vocalPath,
          backingPath: join(dir, 'missing.f32'),
          manifest: audioManifest(1000),
          outputWavPath: join(dir, 'mix.wav'),
        }),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('mixes a ten-minute take in streaming fashion within a few seconds', async () => {
    await withTempDir(async (dir) => {
      const frames = TEST_SAMPLE_RATE * 600;
      // One second of audio repeated: big on disk, small in this test's memory.
      const second = stereoSine(TEST_SAMPLE_RATE, 330, 0.2);
      const vocalPath = join(dir, 'vocal.f32');
      const backingPath = join(dir, 'backing.f32');
      const secondBytes = Buffer.from(second.buffer);
      const tenSeconds = Buffer.concat(Array.from({ length: 10 }, () => secondBytes));
      for (let chunk = 0; chunk < 60; chunk++) {
        await appendFile(vocalPath, tenSeconds);
        await appendFile(backingPath, tenSeconds);
      }

      const heapBefore = process.memoryUsage().arrayBuffers;
      const startedAt = performance.now();
      const result = await mixTake({
        vocalPath,
        backingPath,
        manifest: audioManifest(frames, 0.02),
        outputWavPath: join(dir, 'mix.wav'),
      });
      const elapsedSec = (performance.now() - startedAt) / 1000;
      const heapGrowth = process.memoryUsage().arrayBuffers - heapBefore;

      process.stdout.write(`    10-minute mixdown took ${elapsedSec.toFixed(2)} s\n`);
      expect(result.durationSec).toBeCloseTo(600 - 0.02, 3);
      expect((await stat(join(dir, 'mix.wav'))).size).toBe(
        FLOAT_WAV_HEADER_BYTES + result.outputFrames * 8,
      );
      // The stems are 230 MB each; the mixer must not have pulled them into memory.
      expect(heapGrowth).toBeLessThan(16 * 1024 * 1024);
      expect(elapsedSec).toBeLessThan(20);
    });
  });
});
