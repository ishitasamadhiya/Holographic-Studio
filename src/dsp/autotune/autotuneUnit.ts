import { clamp01 } from '@shared/controls';
import type { PitchTargetData } from '@shared/music';
import { hzToMidi } from '@shared/music';
import type { EffectUnit } from '../effectUnit';
import { clamp, SEMITONE_LN } from '../math';
import {
  AUTOTUNE_MAX_CORRECTION_SEMITONES,
  autotuneAmount,
  autotuneRetuneSeconds,
} from '../parameterMapping';
import { PitchDetector } from '../pitch/pitchDetector';
import { PitchShifter } from '../pitch/pitchShifter';
import { OnePoleSmoother, smoothingCoefficient } from '../smoothing';
import { NoteChoicePitch } from './noteChoicePitch';
import { PitchTargetSelector } from './targetSelector';

/** Glide applied to the correction amount when the intensity control moves. */
const AMOUNT_SMOOTHING_SEC = 0.02;

/** How fast a correction is let go when the voice stops, whatever the retune speed. */
const RELEASE_SEC = 0.008;

/**
 * Estimates the detector must report "unvoiced" in a row before the correction is released.
 * One uncertain estimate in the middle of a note (10 ms) should not make the pitch wobble.
 */
const UNVOICED_HOLD_FRAMES = 2;

/** After this many unvoiced estimates (~100 ms) the next note starts with no held target. */
const TARGET_MEMORY_FRAMES = 20;

/** Corrections smaller than a hundredth of a cent are treated as none at all. */
const CORRECTION_EPSILON = 1e-4;

/**
 * Live pitch correction: detect the sung pitch, choose a target note, and shift the voice
 * toward it.
 *
 *   correction = clamp(target − sung) · amount       (semitones)
 *
 * following the singer with the retune time constant; amount and retune time both come from
 * the intensity (see parameterMapping). The input is treated as mono (the two channels are
 * averaged) and the result is written to both channels.
 */
export class AutotuneUnit implements EffectUnit {
  readonly latencySamples: number = 0;

  /** Sung pitch as a fractional MIDI note; NaN while no pitch is detected. */
  detectedMidi = Number.NaN;
  /** Note being pulled toward as a fractional MIDI note; NaN while no pitch is detected. */
  targetMidi = Number.NaN;

  private readonly sampleRate: number = 0;
  private readonly detector: PitchDetector;
  private readonly selector = new PitchTargetSelector();
  private readonly shifter: PitchShifter;
  /** The sung pitch with the vibrato averaged out: what the target note is chosen from. */
  private readonly noteChoice: NoteChoicePitch;
  private readonly amount: OnePoleSmoother;
  /** Scratch: the pitch ratio for each sample of the stretch being processed. */
  private readonly ratios: Float32Array;
  private readonly releaseCoefficient: number = 0;

  private retuneCoefficient: number = 0;
  /** Pitch error being followed (semitones), before the amount is applied. */
  private error = 0;
  private errorTarget = 0;
  private errorCoefficient: number = 0;
  /** Correction currently applied, in semitones. */
  private correction = 0;

  private unvoicedFrames = TARGET_MEMORY_FRAMES;

  /** Song time of the sample at `framesSincePosition` = 0; NaN when no song clock is running. */
  private songPositionSec = Number.NaN;
  private framesSincePosition = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.detector = new PitchDetector({ sampleRate });
    this.shifter = new PitchShifter({
      sampleRate,
      maxShiftSemitones: AUTOTUNE_MAX_CORRECTION_SEMITONES + 1,
    });
    this.latencySamples = this.shifter.latencySamples;
    this.amount = new OnePoleSmoother(0, AMOUNT_SMOOTHING_SEC, sampleRate);
    this.ratios = new Float32Array(this.detector.hopSamples);
    this.noteChoice = new NoteChoicePitch(sampleRate / this.detector.hopSamples);
    this.releaseCoefficient = smoothingCoefficient(RELEASE_SEC, sampleRate);
    this.retuneCoefficient = smoothingCoefficient(autotuneRetuneSeconds(0), sampleRate);
    this.errorCoefficient = this.retuneCoefficient;
  }

  /** Correction currently applied to the voice, in cents (positive = shifted up). */
  get correctionCents(): number {
    return this.correction * 100;
  }

  /** Autotune intensity, 0..1 (0 = off, 1 = hard tune). */
  setIntensity(intensity: number): void {
    if (Number.isNaN(intensity)) return;
    const value = clamp01(intensity);
    this.amount.setTarget(autotuneAmount(value));
    this.retuneCoefficient = smoothingCoefficient(autotuneRetuneSeconds(value), this.sampleRate);
  }

  setPitchTargets(targets: PitchTargetData | null): void {
    this.selector.setTargets(targets);
  }

  /**
   * Song-clock time of the next sample to be processed, or null when no song is playing
   * (the melody is then ignored). Between calls the position advances with the audio.
   */
  setSongPosition(positionSec: number | null): void {
    this.songPositionSec =
      positionSec === null || !Number.isFinite(positionSec) ? Number.NaN : positionSec;
    this.framesSincePosition = 0;
  }

  process(left: Float32Array, right: Float32Array, frameCount: number): void {
    const detector = this.detector;
    const ratios = this.ratios;
    // Work in stretches that end exactly where the detector publishes an estimate, so a new
    // estimate takes effect at the same sample however the stream is cut into blocks.
    for (let offset = 0; offset < frameCount;) {
      const frames = Math.min(frameCount - offset, detector.framesUntilEstimate, ratios.length);
      const end = offset + frames;
      for (let i = offset; i < end; i++) left[i] = 0.5 * (left[i]! + right[i]!);

      const hasNewEstimate = detector.push(left, offset, frames);
      this.fillRatios(frames);
      this.shifter.process(left, offset, frames, ratios);
      for (let i = offset; i < end; i++) right[i] = left[i]!;

      this.framesSincePosition += frames;
      if (hasNewEstimate) this.onPitchEstimate();
      offset = end;
    }
  }

  reset(): void {
    this.detector.reset();
    this.shifter.reset();
    this.selector.reset();
    this.amount.snapTo(this.amount.targetValue);
    this.error = 0;
    this.errorTarget = 0;
    this.errorCoefficient = this.retuneCoefficient;
    this.correction = 0;
    this.noteChoice.restart();
    this.unvoicedFrames = TARGET_MEMORY_FRAMES;
    this.detectedMidi = Number.NaN;
    this.targetMidi = Number.NaN;
  }

  /** Writes the pitch ratio of each of the next `frames` samples into the scratch buffer. */
  private fillRatios(frames: number): void {
    const ratios = this.ratios;
    // First the smoothed amount per sample, then (in place) the ratio it leads to.
    this.amount.fill(ratios, frames);
    const target = this.errorTarget;
    const coefficient = this.errorCoefficient;
    let error = this.error;
    let correction = this.correction;
    let ratio = correction === 0 ? 1 : Math.exp(correction * SEMITONE_LN);
    for (let i = 0; i < frames; i++) {
      if (error !== target) {
        const remaining = target - error;
        error =
          remaining < CORRECTION_EPSILON && remaining > -CORRECTION_EPSILON
            ? target
            : error + coefficient * remaining;
      }
      const next = error * ratios[i]!;
      if (next !== correction) {
        correction = next;
        ratio = Math.exp(correction * SEMITONE_LN);
      }
      ratios[i] = ratio;
    }
    this.error = error;
    this.correction = correction;
  }

  private onPitchEstimate(): void {
    const detector = this.detector;
    if (!detector.voiced) {
      this.unvoicedFrames++;
      if (this.unvoicedFrames >= UNVOICED_HOLD_FRAMES) {
        // Never leave a correction meant for a note applied to a consonant or to noise.
        this.errorTarget = 0;
        this.errorCoefficient = Math.max(this.retuneCoefficient, this.releaseCoefficient);
        // Lets the shifter return to its nominal delay once the correction is gone.
        this.shifter.clearPeriod();
        this.detectedMidi = Number.NaN;
        this.targetMidi = Number.NaN;
      }
      if (this.unvoicedFrames === TARGET_MEMORY_FRAMES) this.selector.reset();
      return;
    }

    const sungMidi = hzToMidi(detector.f0Hz);
    const isNewPhrase = this.unvoicedFrames >= TARGET_MEMORY_FRAMES;
    this.unvoicedFrames = 0;

    this.shifter.setPeriod(detector.periodSamples);
    this.detectedMidi = sungMidi;
    const noteChoice = this.noteChoice;
    if (isNewPhrase) noteChoice.restart();
    noteChoice.push(sungMidi);
    // Possibly the first estimate of a new note: correcting it toward the old note would
    // pull the wrong way, so the current correction is kept until the next estimate decides.
    if (noteChoice.uncertain) return;
    // Until the average spans a whole vibrato cycle its value still swings, and the note
    // held meanwhile may be the wrong neighbour; decide once afresh when it becomes reliable.
    if (noteChoice.settledNow) this.selector.reset();

    // Song time of the sample that completed this estimate (the last one fed so far).
    const songPositionSec = this.songPositionSec + (this.framesSincePosition - 1) / this.sampleRate;
    const targetMidi = this.selector.select(noteChoice.value, songPositionSec);

    this.errorTarget = clamp(
      targetMidi - sungMidi,
      -AUTOTUNE_MAX_CORRECTION_SEMITONES,
      AUTOTUNE_MAX_CORRECTION_SEMITONES,
    );
    this.errorCoefficient = this.retuneCoefficient;
    this.targetMidi = targetMidi;
  }
}
