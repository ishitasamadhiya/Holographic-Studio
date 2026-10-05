import { describe, expect, it } from 'vitest';
import type { TakeManifest } from '@shared/take';
import { AlignedStemMix } from './alignedStemMix';
import { planMix } from './mixPlan';
import {
  audioManifest,
  silentStem,
  TEST_SAMPLE_RATE,
  videoManifest,
  withTempDir,
  writeStems,
} from './testSupport';

const STEM_FRAMES = TEST_SAMPLE_RATE * 2;
const VOCAL_LATENCY_SEC = 0.0375;
const LATENCY_FRAMES = Math.round(VOCAL_LATENCY_SEC * TEST_SAMPLE_RATE);
/** The backing click the singer hears, as a frame of the backing stem. */
const BACKING_CLICK_FRAME = 40_000;

/**
 * A singer in perfect time: the backing click (right channel) is at BACKING_CLICK_FRAME and
 * the sung reply (left channel) reaches the recorder one vocal latency later.
 */
function impulseStems(): { vocal: Float32Array; backing: Float32Array } {
  const vocal = silentStem(STEM_FRAMES);
  const backing = silentStem(STEM_FRAMES);
  backing[BACKING_CLICK_FRAME * 2 + 1] = 0.25;
  vocal[(BACKING_CLICK_FRAME + LATENCY_FRAMES) * 2] = 0.5;
  return { vocal, backing };
}

async function renderWholeMix(manifest: TakeManifest): Promise<Float32Array> {
  return withTempDir(async (dir) => {
    const { vocal, backing } = impulseStems();
    const { vocalPath, backingPath } = await writeStems(dir, vocal, backing);
    const plan = planMix(manifest);
    const mix = await AlignedStemMix.open(vocalPath, backingPath, plan);
    try {
      const output = new Float32Array(plan.outputFrames * 2);
      // Read in uneven pieces so block boundaries are exercised too.
      const pieceFrames = 7001;
      for (let start = 0; start < plan.outputFrames; start += pieceFrames) {
        const frames = Math.min(pieceFrames, plan.outputFrames - start);
        const piece = new Float32Array(frames * 2);
        await mix.read(start, frames, piece);
        output.set(piece, start * 2);
      }
      return output;
    } finally {
      await mix.close();
    }
  });
}

function nonZeroFrames(interleaved: Float32Array): number[] {
  const frames: number[] = [];
  for (let frame = 0; frame < interleaved.length / 2; frame++) {
    if (interleaved[frame * 2] !== 0 || interleaved[frame * 2 + 1] !== 0) frames.push(frame);
  }
  return frames;
}

describe('AlignedStemMix (impulse proof of the clock model)', () => {
  it('audio only: the late vocal impulse lands exactly on the backing impulse', async () => {
    const output = await renderWholeMix(audioManifest(STEM_FRAMES, VOCAL_LATENCY_SEC));
    expect(nonZeroFrames(output)).toEqual([BACKING_CLICK_FRAME]);
    expect(output[BACKING_CLICK_FRAME * 2]).toBe(0.5);
    expect(output[BACKING_CLICK_FRAME * 2 + 1]).toBe(0.25);
  });

  it('without compensation the two impulses would be a latency apart', async () => {
    const output = await renderWholeMix(audioManifest(STEM_FRAMES, 0));
    expect(nonZeroFrames(output)).toEqual([
      BACKING_CLICK_FRAME,
      BACKING_CLICK_FRAME + LATENCY_FRAMES,
    ]);
  });

  it('video that started 0.3 s after the audio: both impulses move 0.3 s earlier, together', async () => {
    const output = await renderWholeMix(videoManifest(STEM_FRAMES, VOCAL_LATENCY_SEC, 0.3, 1.5));
    const expectedFrame = BACKING_CLICK_FRAME - Math.round(0.3 * TEST_SAMPLE_RATE);
    expect(output.length).toBe(1.5 * TEST_SAMPLE_RATE * 2);
    expect(nonZeroFrames(output)).toEqual([expectedFrame]);
    expect(output[expectedFrame * 2]).toBe(0.5);
    expect(output[expectedFrame * 2 + 1]).toBe(0.25);
  });

  it('video that started 0.2 s before the audio: silence first, impulses 0.2 s later', async () => {
    const output = await renderWholeMix(videoManifest(STEM_FRAMES, VOCAL_LATENCY_SEC, -0.2, 1.5));
    const expectedFrame = BACKING_CLICK_FRAME + Math.round(0.2 * TEST_SAMPLE_RATE);
    expect(nonZeroFrames(output)).toEqual([expectedFrame]);
    expect(output[expectedFrame * 2]).toBe(0.5);
    expect(output[expectedFrame * 2 + 1]).toBe(0.25);
  });

  it('a video longer than the audio is padded with silence instead of failing', async () => {
    const output = await renderWholeMix(videoManifest(STEM_FRAMES, VOCAL_LATENCY_SEC, 0, 3));
    expect(output.length).toBe(3 * TEST_SAMPLE_RATE * 2);
    expect(nonZeroFrames(output)).toEqual([BACKING_CLICK_FRAME]);
  });

  it('never reads past the frame count in the manifest, even if the file is longer', async () => {
    // The manifest says the take ended before the impulses were captured.
    const output = await renderWholeMix(videoManifest(30_000, VOCAL_LATENCY_SEC, 0, 1.5));
    expect(nonZeroFrames(output)).toEqual([]);
  });

  it('replaces non-finite samples with silence', async () => {
    await withTempDir(async (dir) => {
      const vocal = silentStem(100);
      const backing = silentStem(100);
      vocal[10] = Number.NaN;
      backing[20] = Number.POSITIVE_INFINITY;
      vocal[30] = 0.5;
      const { vocalPath, backingPath } = await writeStems(dir, vocal, backing);
      const mix = await AlignedStemMix.open(vocalPath, backingPath, planMix(audioManifest(100)));
      const output = new Float32Array(200);
      await mix.read(0, 100, output);
      await mix.close();
      expect(output[10]).toBe(0);
      expect(output[20]).toBe(0);
      expect(output[30]).toBe(0.5);
    });
  });

  it('replaces a sum too large for a 32-bit float with silence', async () => {
    await withTempDir(async (dir) => {
      const vocal = silentStem(100);
      const backing = silentStem(100);
      // Each sample is a valid float32 on its own; only their sum overflows to Infinity.
      vocal[10] = 3e38;
      backing[10] = 3e38;
      vocal[20] = -3e38;
      backing[20] = -3e38;
      // The largest pair that still fits is kept as it is.
      vocal[30] = 1.5e38;
      backing[30] = 1.5e38;
      const { vocalPath, backingPath } = await writeStems(dir, vocal, backing);
      const mix = await AlignedStemMix.open(vocalPath, backingPath, planMix(audioManifest(100)));
      const output = new Float32Array(200);
      await mix.read(0, 100, output);
      await mix.close();
      expect(output.every((sample) => Number.isFinite(sample))).toBe(true);
      expect(output[10]).toBe(0);
      expect(output[20]).toBe(0);
      expect(output[30]).toBeCloseTo(3e38, -34);
    });
  });
});
