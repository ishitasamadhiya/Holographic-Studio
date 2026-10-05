import { clamp01, vocalVolumeToGain, VOCAL_VOLUME_UNITY } from '@shared/controls';
import type { PitchTargetData } from '@shared/music';
import { AutotuneUnit } from './autotune/autotuneUnit';
import type { EffectUnit } from './effectUnit';
import { EchoUnit } from './effects/echo';
import { GainUnit } from './effects/gain';
import { LimiterUnit } from './effects/limiter';
import { ReverbUnit } from './effects/reverb';
import { clamp, DENORMAL_FLOOR, SAMPLE_CEILING } from './math';
import { OnePoleSmoother } from './smoothing';

export interface VocalChainControls {
  /** Autotune intensity, 0..1. */
  autotune: number;
  /** Echo intensity, 0..1. */
  echo: number;
  /** Vocal volume, 0..1; 0.5 is unity gain (see vocalVolumeToGain). */
  volume: number;
  /** Microphone input trim, linear 0..2. */
  micGain: number;
  reverbEnabled: boolean;
}

export interface VocalChainMeters {
  /** Peak level entering the chain (after the microphone trim) since the last read. */
  inputPeak: number;
  /** Peak level leaving the chain since the last read. */
  outputPeak: number;
  /** Sung pitch as a fractional MIDI note; NaN when unvoiced. */
  detectedMidi: number;
  /** Note the autotune is pulling toward as a fractional MIDI note; NaN when none. */
  targetMidi: number;
  /** Pitch correction currently applied, in cents (positive = up). */
  correctionCents: number;
}

export interface VocalChainOptions {
  sampleRate: number;
}

export const DEFAULT_VOCAL_CHAIN_CONTROLS: Readonly<VocalChainControls> = {
  autotune: 0,
  echo: 0,
  volume: VOCAL_VOLUME_UNITY,
  micGain: 1,
  reverbEnabled: false,
};

const MAX_MIC_GAIN = 2;
const MIC_GAIN_SMOOTHING_SEC = 0.02;

/** Frames of input conditioned per pass (the size of the gain scratch buffer). */
const INPUT_CHUNK_FRAMES = 128;

/**
 * The complete live vocal effect: microphone trim → autotune → echo → reverb → vocal volume
 * → soft limiter. Mono in, stereo out.
 *
 * Built to run inside an AudioWorkletProcessor: `process` never allocates, accepts any block
 * length, and produces the same samples however the stream is divided into blocks. The
 * setters only store targets; every audible parameter glides to its target inside the chain.
 */
export class VocalChain {
  /**
   * Nominal delay between input and output in samples (the pitch shifter's delay line, 5 ms;
   * the other units add none). It is exact whenever the autotune is not correcting, except
   * just after it stops on a sustained note: then the delay is within ~0.6 pitch periods of
   * this value until the next breath or consonant, where it returns exactly. While the
   * autotune corrects, the delay moves by up to ±0.625 periods around it; below ~170 Hz the
   * shifter cannot centre on 5 ms and averages about 1.3 ms + 0.75 periods while shifting
   * down (about 9 ms at 98 Hz) and less while shifting up.
   */
  readonly latencySamples: number = 0;

  private readonly autotune: AutotuneUnit;
  private readonly echo: EchoUnit;
  private readonly reverb: ReverbUnit;
  private readonly volume: GainUnit;
  private readonly limiter: LimiterUnit;
  /** The processing order. Insert new effects here. */
  private readonly units: readonly EffectUnit[];

  private readonly micGain: OnePoleSmoother;
  private readonly micGainRamp = new Float32Array(INPUT_CHUNK_FRAMES);
  private inputPeak = 0;
  private outputPeak = 0;

  constructor(options: VocalChainOptions) {
    const { sampleRate } = options;
    this.autotune = new AutotuneUnit(sampleRate);
    this.echo = new EchoUnit(sampleRate);
    this.reverb = new ReverbUnit(sampleRate);
    this.volume = new GainUnit(sampleRate);
    this.limiter = new LimiterUnit(sampleRate);
    this.units = [this.autotune, this.echo, this.reverb, this.volume, this.limiter];

    let latency = 0;
    for (const unit of this.units) latency += unit.latencySamples;
    this.latencySamples = latency;

    this.micGain = new OnePoleSmoother(1, MIC_GAIN_SMOOTHING_SEC, sampleRate);
    this.setControls(DEFAULT_VOCAL_CHAIN_CONTROLS);
  }

  /** Sets new control targets. Omitted and NaN values keep their current target. */
  setControls(controls: Partial<VocalChainControls>): void {
    const { autotune, echo, volume, micGain, reverbEnabled } = controls;
    if (autotune !== undefined) this.autotune.setIntensity(autotune);
    if (echo !== undefined) this.echo.setIntensity(echo);
    if (volume !== undefined && !Number.isNaN(volume)) {
      this.volume.setGain(vocalVolumeToGain(clamp01(volume)));
    }
    if (micGain !== undefined && !Number.isNaN(micGain)) {
      this.micGain.setTarget(clamp(micGain, 0, MAX_MIC_GAIN));
    }
    if (reverbEnabled !== undefined) this.reverb.setEnabled(reverbEnabled);
  }

  /** Replaces the autotune's pitch targets (melody, key, tuning). null = nearest semitone. */
  setPitchTargets(targets: PitchTargetData | null): void {
    this.autotune.setPitchTargets(targets);
  }

  /**
   * Song-clock time of the FIRST sample of the next `process` block, or null when no song
   * clock is running (melody notes are then ignored and only the key is used).
   */
  setSongPosition(positionSec: number | null): void {
    this.autotune.setSongPosition(positionSec);
  }

  /**
   * Processes one block. The three buffers must have the same length; `input` may be the
   * same array as one of the outputs.
   */
  process(input: Float32Array, outLeft: Float32Array, outRight: Float32Array): void {
    const frameCount = Math.min(input.length, outLeft.length, outRight.length);
    this.conditionInput(input, outLeft, outRight, frameCount);

    const units = this.units;
    for (let u = 0; u < units.length; u++) units[u]!.process(outLeft, outRight, frameCount);

    let outputPeak = this.outputPeak;
    for (let i = 0; i < frameCount; i++) {
      outputPeak = Math.max(outputPeak, Math.abs(outLeft[i]!), Math.abs(outRight[i]!));
    }
    this.outputPeak = outputPeak;
  }

  /** Copies the meters into `into` and restarts the peak measurement. */
  readMeters(into: VocalChainMeters): void {
    into.inputPeak = this.inputPeak;
    into.outputPeak = this.outputPeak;
    into.detectedMidi = this.autotune.detectedMidi;
    into.targetMidi = this.autotune.targetMidi;
    into.correctionCents = this.autotune.correctionCents;
    this.inputPeak = 0;
    this.outputPeak = 0;
  }

  /**
   * Copies the microphone signal to both outputs, made safe and trimmed: NaN and infinities
   * become silence (they would otherwise circulate in the echo and reverb forever), absurd
   * values are bounded, vanishingly small ones become exactly zero.
   */
  private conditionInput(
    input: Float32Array,
    outLeft: Float32Array,
    outRight: Float32Array,
    frameCount: number,
  ): void {
    const ramp = this.micGainRamp;
    let inputPeak = this.inputPeak;
    for (let offset = 0; offset < frameCount; offset += INPUT_CHUNK_FRAMES) {
      const frames = Math.min(INPUT_CHUNK_FRAMES, frameCount - offset);
      this.micGain.fill(ramp, frames);
      for (let i = 0; i < frames; i++) {
        const raw = input[offset + i]!;
        const bounded = Math.min(Math.max(raw, -SAMPLE_CEILING), SAMPLE_CEILING);
        const audible = bounded > DENORMAL_FLOOR || bounded < -DENORMAL_FLOOR;
        // Infinity - Infinity and NaN - NaN are NaN, so only finite samples pass.
        const sample = audible && raw - raw === 0 ? bounded * ramp[i]! : 0;
        inputPeak = Math.max(inputPeak, Math.abs(sample));
        outLeft[offset + i] = sample;
        outRight[offset + i] = sample;
      }
    }
    this.inputPeak = inputPeak;
  }

  /** Clears all audio state (delay lines, tails, pitch tracking). Control targets are kept. */
  reset(): void {
    for (const unit of this.units) unit.reset();
    this.micGain.snapTo(this.micGain.targetValue);
    this.inputPeak = 0;
    this.outputPeak = 0;
  }
}
