import { STEM_CHANNELS, type TakeManifest } from '@shared/take';
import { AlignedStemMix } from './alignedStemMix';
import { dbToGain, gainToDb } from './decibels';
import { applyEdgeFades } from './edgeFades';
import { LookAheadLimiter } from './limiter';
import { LoudnessMeter } from './loudnessMeter';
import { planMix, type MixPlan } from './mixPlan';
import { TruePeakMeter } from './truePeakMeter';
import { WavWriter } from './wavWriter';

/** Streaming-friendly loudness: what the big video and music platforms normalise to. */
export const TARGET_LOUDNESS_LUFS = -14;
export const PEAK_CEILING_DBFS = -1;
/** A very quiet take is brought up by at most this much, so room noise is not turned into a roar. */
export const MAX_BOOST_DB = 12;
export const MAX_CUT_DB = 24;

const BLOCK_FRAMES = 16384;
const EDGE_FADE_SEC = 0.005;
/** Share of the progress bar given to the measuring pass; the rest is the rendering pass. */
const MEASURE_PASS_SHARE = 0.45;

export interface MixTakeOptions {
  vocalPath: string;
  backingPath: string;
  manifest: TakeManifest;
  outputWavPath: string;
  /** Called with the overall fraction done, 0..1, never decreasing. */
  onProgress?: (fraction: number) => void;
  /** Aborting rejects with the signal's reason and removes the unfinished WAV. */
  signal?: AbortSignal;
}

export interface MixResult {
  sampleRate: number;
  outputFrames: number;
  durationSec: number;
  /** Integrated loudness of the raw mix before any gain; -Infinity for silence. */
  measuredLufs: number;
  /** Estimated true peak of the raw mix in dBFS; -Infinity for silence. */
  truePeakDbfs: number;
  /** Static gain that was applied before limiting. */
  gainDb: number;
  /** Highest sample of the finished file in dBFS; never above the ceiling. */
  outputPeakDbfs: number;
}

interface MixMeasurement {
  integratedLufs: number;
  truePeak: number;
}

type BlockVisitor = (block: Float32Array, frameCount: number, startFrame: number) => Promise<void>;

/** One static gain toward the target loudness; silence (nothing measurable) is left alone. */
export function chooseGainDb(measuredLufs: number): number {
  if (!Number.isFinite(measuredLufs)) return 0;
  return Math.min(MAX_BOOST_DB, Math.max(-MAX_CUT_DB, TARGET_LOUDNESS_LUFS - measuredLufs));
}

async function forEachBlock(
  mix: AlignedStemMix,
  plan: MixPlan,
  signal: AbortSignal | undefined,
  visit: BlockVisitor,
): Promise<void> {
  const block = new Float32Array(BLOCK_FRAMES * STEM_CHANNELS);
  for (let startFrame = 0; startFrame < plan.outputFrames; startFrame += BLOCK_FRAMES) {
    signal?.throwIfAborted();
    const frameCount = Math.min(BLOCK_FRAMES, plan.outputFrames - startFrame);
    await mix.read(startFrame, frameCount, block);
    await visit(block, frameCount, startFrame);
  }
  signal?.throwIfAborted();
}

async function measureMix(
  mix: AlignedStemMix,
  plan: MixPlan,
  signal: AbortSignal | undefined,
  onFraction: (fraction: number) => void,
): Promise<MixMeasurement> {
  const loudness = new LoudnessMeter(plan.sampleRate);
  const peak = new TruePeakMeter();
  await forEachBlock(mix, plan, signal, async (block, frameCount, startFrame) => {
    loudness.process(block, frameCount);
    peak.process(block, frameCount);
    onFraction((startFrame + frameCount) / plan.outputFrames);
  });
  return { integratedLufs: loudness.integratedLufs(), truePeak: peak.truePeak() };
}

/** Applies the gain, limits, fades the edges and writes the WAV. Returns the output sample peak. */
async function renderMix(
  mix: AlignedStemMix,
  plan: MixPlan,
  gainDb: number,
  outputWavPath: string,
  signal: AbortSignal | undefined,
  onFraction: (fraction: number) => void,
): Promise<number> {
  const gain = dbToGain(gainDb);
  const limiter = new LookAheadLimiter({
    sampleRate: plan.sampleRate,
    ceiling: dbToGain(PEAK_CEILING_DBFS),
  });
  const fadeFrames = Math.round(EDGE_FADE_SEC * plan.sampleRate);
  const writer = await WavWriter.create(outputWavPath, {
    sampleRate: plan.sampleRate,
    channels: STEM_CHANNELS,
    frameCount: plan.outputFrames,
  });

  let framesWritten = 0;
  let outputPeak = 0;
  const finishBlock = async (block: Float32Array, frameCount: number): Promise<void> => {
    applyEdgeFades(block, frameCount, framesWritten, plan.outputFrames, fadeFrames);
    const sampleCount = frameCount * STEM_CHANNELS;
    for (let index = 0; index < sampleCount; index++) {
      const magnitude = Math.abs(block[index]!);
      if (magnitude > outputPeak) outputPeak = magnitude;
    }
    await writer.write(block, frameCount);
    framesWritten += frameCount;
  };

  try {
    await forEachBlock(mix, plan, signal, async (block, frameCount) => {
      const sampleCount = frameCount * STEM_CHANNELS;
      for (let index = 0; index < sampleCount; index++) {
        block[index] = block[index]! * gain;
      }
      const readyFrames = limiter.process(block, frameCount, block);
      await finishBlock(block, readyFrames);
      onFraction(framesWritten / plan.outputFrames);
    });
    const tail = new Float32Array(limiter.lookAheadFrames * STEM_CHANNELS);
    await finishBlock(tail, limiter.flush(tail));
    await writer.close();
  } catch (error) {
    await writer.abort();
    throw error;
  }
  return outputPeak;
}

/**
 * Renders a take's two stems into one finished stereo WAV (32-bit float, at the take's
 * sample rate): latency-compensated sum, loudness-normalised toward -14 LUFS with a single
 * static gain, then peak-limited to -1 dBFS. Works in two streaming passes — measure, then
 * render — so even a very long take needs only a few hundred kilobytes of memory.
 */
export async function mixTake(options: MixTakeOptions): Promise<MixResult> {
  const { vocalPath, backingPath, manifest, outputWavPath, onProgress, signal } = options;
  const plan = planMix(manifest);

  let reported = 0;
  const report = (fraction: number): void => {
    const clamped = Math.min(1, Math.max(reported, fraction));
    if (clamped === reported) return;
    reported = clamped;
    onProgress?.(clamped);
  };

  signal?.throwIfAborted();
  const mix = await AlignedStemMix.open(vocalPath, backingPath, plan);
  try {
    const measurement = await measureMix(mix, plan, signal, (fraction) =>
      report(fraction * MEASURE_PASS_SHARE),
    );
    const gainDb = chooseGainDb(measurement.integratedLufs);
    const outputPeak = await renderMix(mix, plan, gainDb, outputWavPath, signal, (fraction) =>
      report(MEASURE_PASS_SHARE + fraction * (1 - MEASURE_PASS_SHARE)),
    );
    report(1);
    return {
      sampleRate: plan.sampleRate,
      outputFrames: plan.outputFrames,
      durationSec: plan.outputFrames / plan.sampleRate,
      measuredLufs: measurement.integratedLufs,
      truePeakDbfs: gainToDb(measurement.truePeak),
      gainDb,
      outputPeakDbfs: gainToDb(outputPeak),
    };
  } finally {
    await mix.close();
  }
}
