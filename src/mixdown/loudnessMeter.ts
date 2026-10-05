import { STEM_CHANNELS } from '@shared/take';
import { kWeightingCoefficients, type KWeightingCoefficients } from './kWeighting';

// A module-local copy: imported bindings are slow to read inside per-sample loops under
// the test runner's module transform.
const CHANNELS = STEM_CHANNELS;

// ITU-R BS.1770-4 gating: loudness is measured in 400 ms blocks that overlap by 75 %.
const HOP_SEC = 0.1;
const HOPS_PER_BLOCK = 4;
/** Blocks quieter than this never count (silence between phrases). */
const ABSOLUTE_GATE_LUFS = -70;
/** Blocks more than this far below the average of the remaining blocks do not count either. */
const RELATIVE_GATE_LU = 10;
/** Makes a full-scale 997 Hz sine in one channel read -3.01 LKFS, as the standard requires. */
const LOUDNESS_OFFSET_DB = -0.691;

function energyToLufs(meanSquare: number): number {
  return LOUDNESS_OFFSET_DB + 10 * Math.log10(meanSquare);
}

function lufsToEnergy(lufs: number): number {
  return 10 ** ((lufs - LOUDNESS_OFFSET_DB) / 10);
}

/**
 * Streaming integrated-loudness meter for interleaved stereo audio (ITU-R BS.1770-4 / EBU R 128:
 * K-weighting, 400 ms blocks, absolute gate at -70 LUFS, relative gate at -10 LU).
 * Feed it the whole programme in blocks of any size, then read integratedLufs().
 */
export class LoudnessMeter {
  private readonly coefficients: KWeightingCoefficients;
  private readonly hopFrames: number;
  /** Two filter stages x two state variables per channel (transposed direct form II). */
  private readonly filterState = new Float64Array(CHANNELS * 4);
  /** Sum of squares (both channels) of each completed 100 ms hop. */
  private readonly hopEnergies: number[] = [];
  private currentHopEnergy = 0;
  private currentHopFrames = 0;
  private totalEnergy = 0;
  private totalFrames = 0;

  constructor(sampleRate: number) {
    this.coefficients = kWeightingCoefficients(sampleRate);
    this.hopFrames = Math.max(1, Math.round(HOP_SEC * sampleRate));
  }

  process(interleaved: Float32Array, frameCount: number): void {
    const { shelf, highPass } = this.coefficients;
    const state = this.filterState;
    let hopEnergy = this.currentHopEnergy;
    let hopFill = this.currentHopFrames;
    let processedEnergy = 0;

    for (let frame = 0; frame < frameCount; frame++) {
      let frameEnergy = 0;
      for (let channel = 0; channel < CHANNELS; channel++) {
        const base = channel * 4;
        const input = interleaved[frame * CHANNELS + channel]!;

        const shelved = shelf.b0 * input + state[base]!;
        state[base] = shelf.b1 * input - shelf.a1 * shelved + state[base + 1]!;
        state[base + 1] = shelf.b2 * input - shelf.a2 * shelved;

        const weighted = highPass.b0 * shelved + state[base + 2]!;
        state[base + 2] = highPass.b1 * shelved - highPass.a1 * weighted + state[base + 3]!;
        state[base + 3] = highPass.b2 * shelved - highPass.a2 * weighted;

        frameEnergy += weighted * weighted;
      }

      hopEnergy += frameEnergy;
      processedEnergy += frameEnergy;
      hopFill += 1;
      if (hopFill === this.hopFrames) {
        this.hopEnergies.push(hopEnergy);
        hopEnergy = 0;
        hopFill = 0;
      }
    }

    this.currentHopEnergy = hopEnergy;
    this.currentHopFrames = hopFill;
    this.totalEnergy += processedEnergy;
    this.totalFrames += frameCount;
  }

  /** Integrated loudness of everything processed so far; -Infinity when nothing passes the gates. */
  integratedLufs(): number {
    const blockEnergies = this.blockMeanSquares();
    const absoluteGate = lufsToEnergy(ABSOLUTE_GATE_LUFS);
    const audible = blockEnergies.filter((energy) => energy > absoluteGate);
    if (audible.length === 0) return Number.NEGATIVE_INFINITY;

    const relativeGate = lufsToEnergy(energyToLufs(mean(audible)) - RELATIVE_GATE_LU);
    const gated = audible.filter((energy) => energy > relativeGate);
    return gated.length > 0 ? energyToLufs(mean(gated)) : Number.NEGATIVE_INFINITY;
  }

  /** Mean square (summed over channels) of every 400 ms gating block. */
  private blockMeanSquares(): number[] {
    const hops = this.hopEnergies;
    if (hops.length < HOPS_PER_BLOCK) {
      // Too short for even one gating block: measure the whole signal as a single block.
      return this.totalFrames > 0 ? [this.totalEnergy / this.totalFrames] : [];
    }
    const blockFrames = HOPS_PER_BLOCK * this.hopFrames;
    const blocks: number[] = [];
    let windowEnergy = 0;
    for (let hop = 0; hop < hops.length; hop++) {
      windowEnergy += hops[hop]!;
      if (hop >= HOPS_PER_BLOCK) windowEnergy -= hops[hop - HOPS_PER_BLOCK]!;
      if (hop >= HOPS_PER_BLOCK - 1) blocks.push(Math.max(0, windowEnergy) / blockFrames);
    }
    return blocks;
  }
}

function mean(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}
