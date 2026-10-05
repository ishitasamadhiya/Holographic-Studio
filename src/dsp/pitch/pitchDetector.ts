import { BiquadHighpass } from '../filters';
import { MirroredHistory } from '../history';
import { decibelsToGain } from '../math';
import { designLowpassFir } from './decimator';
import { computeNsdf, NsdfPeaks } from './nsdf';
import { PeriodRefiner } from './periodRefiner';

export const PITCH_MIN_HZ = 70;
export const PITCH_MAX_HZ = 1000;

/** Time between pitch estimates. */
const HOP_SEC = 0.005;

/**
 * Candidate periods are found on a copy of the signal decimated to about this rate: the
 * search is 36× cheaper than at 48 kHz, and the precise period comes from the second stage.
 */
const ANALYSIS_RATE_HZ = 8000;

/**
 * Anti-alias filter: taps per decimation step, and -6 dB point relative to the decimated
 * rate (2 kHz). The cutoff is well below what aliasing alone would require: keeping only the
 * lowest harmonics makes the autocorrelation smooth enough to be sampled on an 8 kHz grid.
 */
const FIR_TAPS_PER_STEP = 8;
const FIR_CUTOFF = 0.25;

/** The analysis window holds a little over two periods of the lowest detectable pitch. */
const WINDOW_PERIODS = 2.2;

/** Removes DC and rumble, which would otherwise look perfectly "periodic" at every lag. */
const HIGHPASS_HZ = 55;

/** Below this clarity the signal is treated as unvoiced (noise scores ~0.2–0.35, a clean voice > 0.9). */
export const CLARITY_THRESHOLD = 0.55;

/** Windows quieter than this are silence, whatever their shape. */
const SILENCE_RMS = decibelsToGain(-55);

/**
 * MPM's rule, used twice: the period is the SHORTEST candidate that is at least this good
 * relative to the best one. Longer candidates of similar quality are its multiples; shorter,
 * clearly worse ones are strong harmonics. The value is at the strict end of the usual
 * 0.8–1.0 range on purpose: mistaking a multiple for the period keeps the note name (and
 * so the correction) right, while locking onto a loud harmonic on a formant would not.
 */
const PERIOD_ACCEPTANCE = 0.95;

/**
 * Light octave-jump suppression. The candidate that continues the note being tracked is
 * accepted a little more easily, and a shorter period needs slightly stronger evidence to
 * replace it, so a borderline signal does not flip between octaves from estimate to estimate.
 */
const TRACKED_ACCEPTANCE = 0.92;
const DEPARTURE_ACCEPTANCE = 0.97;
/** A candidate within this fraction of the previous period continues the same note. */
const TRACKING_TOLERANCE = 0.2;

/**
 * Heights measured on the decimated signal can read up to ~12% low (a narrow lobe sampled
 * off its top). Any shorter candidate above this fraction of the best is therefore re-measured
 * at the full rate before it is dismissed.
 */
const CONTENDER_FRACTION = 0.8;
/** How many such candidates are re-measured per estimate (bounds the cost). */
const MAX_SHORTER_CHECKS = 2;

/** A full-rate clarity this high leaves no room for a better candidate; no second opinion needed. */
const UNQUESTIONABLE_CLARITY = 0.97;

/** A dropout shorter than this many estimates does not erase the tracked period. */
const TRACKING_MEMORY_FRAMES = 4;

/**
 * A pitch that does not continue the previous estimate (coming from unvoiced, or more than
 * this ratio, 50 cents, away from it) is only published once the next estimate agrees with
 * it to within the same ratio; meanwhile the estimate is reported unvoiced. Around note
 * onsets and endings the newest few milliseconds can be a decaying first-formant ring that
 * looks convincingly periodic at the formant, and narrow-band noise (rumble, a fan)
 * occasionally scores above the clarity gate, but neither repeats at the same pitch. Vibrato
 * and glides move under 25 cents per estimate, so only real leaps pay the 5 ms delay.
 */
const AGREEMENT_RATIO = 2 ** (50 / 1200);

export interface PitchDetectorOptions {
  sampleRate: number;
}

/**
 * Streaming monophonic pitch detector.
 *
 * Feed it the signal in blocks of any size; every `hopSamples` samples it publishes a new
 * estimate in its public fields. Two stages:
 *
 *   1. McLeod (MPM) autocorrelation on a ~32 ms window of a low-passed, decimated copy. It
 *      proposes candidate periods (the true period, its multiples, strong harmonics) and
 *      says whether the window is periodic at all.
 *   2. PeriodRefiner measures candidates at the full sample rate on the newest two periods.
 *      That measurement is precise and fresh, so it both arbitrates between the candidates
 *      and provides the published period.
 *
 * Cost is bounded: per hop one decimated autocorrelation (≈25k multiply-adds) and at most
 * four refinements (≤ ≈20k each; one, a few thousand, for a clean voice) — at most one hop
 * per 128-frame block at 48 kHz — plus ~15 multiply-adds per sample. Everything is passed
 * between its parts as typed arrays and whole numbers, so nothing is allocated.
 */
export class PitchDetector {
  /** Input samples between two estimates. */
  readonly hopSamples: number = 0;

  /** True when the latest estimate found a pitch. */
  voiced = false;
  /** Fundamental frequency of the latest estimate in Hz; 0 when unvoiced. */
  f0Hz = 0;
  /** Period of the latest estimate in input samples; 0 when unvoiced. */
  periodSamples = 0;
  /** 0..1: how periodic the signal is (reported for unvoiced estimates too). */
  clarity = 0;

  private readonly sampleRate: number = 0;
  private readonly decimation: number = 0;
  private readonly hopDecimated: number = 0;
  private readonly windowLength: number = 0;
  private readonly minLag: number = 0;
  private readonly maxLag: number = 0;

  private readonly highpass: BiquadHighpass;
  private readonly firTaps: Float32Array;
  private readonly history: MirroredHistory;
  private readonly decimated: MirroredHistory;
  /** Scratch: one hop of high-passed input, and the decimated samples it produces. */
  private readonly filtered: Float32Array;
  private readonly decimatedBlock: Float32Array;
  private readonly nsdf: Float32Array;
  private readonly peaks: NsdfPeaks;
  private readonly refiner: PeriodRefiner;
  /** Full-rate measurements of the candidates of the current estimate (0 clarity = not measured yet). */
  private readonly refinedPeriods: Float64Array;
  private readonly refinedClarities: Float64Array;
  private readonly refinedFlags: Uint8Array;

  private decimationPhase = 0;
  private hopPhase = 0;
  /** Period of the previous voiced estimate in decimated samples; 0 = nothing being tracked. */
  private trackedLag = 0;
  /** Period of a new pitch awaiting confirmation by the next estimate; 0 = none. */
  private pendingPeriod = 0;
  private unvoicedFrames = 0;

  constructor(options: PitchDetectorOptions) {
    const { sampleRate } = options;
    this.sampleRate = sampleRate;
    this.decimation = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE_HZ));
    const analysisRate = sampleRate / this.decimation;
    this.hopDecimated = Math.max(1, Math.round(HOP_SEC * analysisRate));
    this.hopSamples = this.hopDecimated * this.decimation;

    this.minLag = Math.max(2, Math.floor(analysisRate / PITCH_MAX_HZ) - 1);
    this.maxLag = Math.ceil(analysisRate / PITCH_MIN_HZ) + 1;
    this.windowLength = Math.ceil(WINDOW_PERIODS * this.maxLag);

    this.highpass = new BiquadHighpass(HIGHPASS_HZ, sampleRate);
    this.firTaps = designLowpassFir(
      FIR_TAPS_PER_STEP * this.decimation + 1,
      FIR_CUTOFF / this.decimation,
    );
    this.refiner = new PeriodRefiner(sampleRate, (this.maxLag + 1) * this.decimation);
    // The refiner looks back from the newest sample; the filter from any sample of a hop.
    this.history = new MirroredHistory(
      Math.max(this.firTaps.length + this.hopSamples, this.refiner.requiredHistory) + 1,
    );
    this.decimated = new MirroredHistory(this.windowLength);
    this.filtered = new Float32Array(this.hopSamples);
    this.decimatedBlock = new Float32Array(this.hopDecimated);
    this.nsdf = new Float32Array(this.maxLag + 2);
    this.peaks = new NsdfPeaks(this.maxLag + 1);
    const maxCandidates = ((this.maxLag + 1) >> 1) + 2;
    this.refinedPeriods = new Float64Array(maxCandidates);
    this.refinedClarities = new Float64Array(maxCandidates);
    this.refinedFlags = new Uint8Array(maxCandidates);
  }

  /** Samples still to be fed before the next estimate is published (at least 1). */
  get framesUntilEstimate(): number {
    return (this.hopDecimated - this.hopPhase) * this.decimation - this.decimationPhase;
  }

  /**
   * Feeds `count` samples of `samples`, starting at `offset`. Returns true when a hop was
   * completed, i.e. the public fields now hold a new estimate. An estimate describes the
   * signal up to the sample that completed its hop, so a caller that needs to react at the
   * exact sample should feed at most `framesUntilEstimate` samples per call.
   */
  push(samples: Float32Array, offset: number, count: number): boolean {
    let published = false;
    for (let done = 0; done < count;) {
      const frames = Math.min(count - done, this.framesUntilEstimate);
      this.highpass.processBlock(samples, offset + done, frames, this.filtered);
      this.history.pushBlock(this.filtered, 0, frames);
      this.decimate(frames);
      done += frames;
      if (this.hopPhase === this.hopDecimated) {
        this.hopPhase = 0;
        this.analyze();
        published = true;
      }
    }
    return published;
  }

  reset(): void {
    this.highpass.reset();
    this.history.clear();
    this.decimated.clear();
    this.decimationPhase = 0;
    this.hopPhase = 0;
    this.trackedLag = 0;
    this.pendingPeriod = 0;
    this.unvoicedFrames = 0;
    this.voiced = false;
    this.f0Hz = 0;
    this.periodSamples = 0;
    this.clarity = 0;
  }

  /** Runs the anti-alias filter over the `frames` newest samples, keeping every Nth output. */
  private decimate(frames: number): void {
    const data = this.history.data;
    const taps = this.firTaps;
    const firstIndex = this.history.newestIndex - frames + 1;
    let phase = this.decimationPhase;
    let produced = 0;
    for (let i = 0; i < frames; i++) {
      if (++phase < this.decimation) continue;
      phase = 0;
      const newest = firstIndex + i;
      let sum = 0;
      for (let k = 0; k < taps.length; k++) sum += taps[k]! * data[newest - k]!;
      this.decimatedBlock[produced++] = sum;
    }
    this.decimationPhase = phase;
    this.decimated.pushBlock(this.decimatedBlock, 0, produced);
    this.hopPhase += produced;
  }

  private analyze(): void {
    const samples = this.decimated.data;
    const start = this.decimated.newestIndex - this.windowLength + 1;

    let energy = 0;
    for (let j = 0; j < this.windowLength; j++) energy += samples[start + j]! * samples[start + j]!;
    if (energy < SILENCE_RMS * SILENCE_RMS * this.windowLength) {
      this.publishUnvoiced(0);
      return;
    }

    computeNsdf(samples, start, this.windowLength, this.maxLag + 1, this.nsdf);
    const peaks = this.peaks;
    peaks.find(this.nsdf, this.minLag, this.maxLag);
    if (peaks.count === 0) {
      this.publishUnvoiced(0);
      return;
    }

    this.refinedFlags.fill(0, 0, peaks.count);
    const chosen = this.choosePeriod();
    // The long window keeps "hearing" a note for a while after it stopped; the short one
    // does not. Taking the lower of the two makes note endings release promptly.
    const clarity = Math.min(peaks.height(peaks.highestIndex), this.refinedClarity(chosen));
    if (clarity < CLARITY_THRESHOLD) {
      this.publishUnvoiced(clarity);
      return;
    }

    const period = this.refinedPeriods[chosen]!;
    const previous = this.voiced ? this.periodSamples : this.pendingPeriod;
    if (!(period < previous * AGREEMENT_RATIO && previous < period * AGREEMENT_RATIO)) {
      this.publishUnvoiced(clarity);
      this.pendingPeriod = period;
      return;
    }
    this.pendingPeriod = 0;
    this.voiced = true;
    this.clarity = clarity;
    this.periodSamples = period;
    this.f0Hz = this.sampleRate / period;
    this.trackedLag = period / this.decimation;
    this.unvoicedFrames = 0;
  }

  /**
   * Picks the candidate that is the pitch period: MPM's rule (shortest candidate nearly as
   * good as the best), with the candidates' quality measured at the full rate wherever the
   * decimated measurement alone could be wrong.
   */
  private choosePeriod(): number {
    const peaks = this.peaks;
    const tracked = this.trackedLag > 0 ? peaks.nearest(this.trackedLag, TRACKING_TOLERANCE) : -1;
    const strongest = peaks.highestIndex;

    let reference = peaks.firstReaching(PERIOD_ACCEPTANCE);
    let firstContender = 0;
    if (strongest > reference && this.refinedClarity(reference) < UNQUESTIONABLE_CLARITY) {
      // The decimated signal says this is the period, but at the full rate it is not
      // convincing. If the strongest lobe is clearly better, this one is only a harmonic.
      const needed = acceptance(reference, strongest, tracked) * this.refinedClarity(strongest);
      if (this.refinedClarity(reference) < needed) {
        firstContender = reference + 1;
        reference = strongest;
      }
    }

    const contenderHeight = CONTENDER_FRACTION * peaks.height(strongest);
    let checks = 0;
    for (let i = firstContender; i < reference && checks < MAX_SHORTER_CHECKS; i++) {
      if (peaks.height(i) < contenderHeight) continue;
      checks++;
      const needed = acceptance(i, reference, tracked) * this.refinedClarity(reference);
      if (this.refinedClarity(i) >= needed) return i;
    }
    return reference;
  }

  /** Full-rate clarity of candidate `index`, measured on first use. */
  private refinedClarity(index: number): number {
    if (this.refinedFlags[index] === 0) {
      this.refiner.refine(
        this.history.data,
        this.history.newestIndex,
        Math.round(this.peaks.lag(index) * this.decimation),
      );
      this.refinedFlags[index] = 1;
      this.refinedPeriods[index] = this.refiner.period;
      this.refinedClarities[index] = this.refiner.clarity;
    }
    return this.refinedClarities[index]!;
  }

  private publishUnvoiced(clarity: number): void {
    this.pendingPeriod = 0;
    this.voiced = false;
    this.clarity = clarity;
    this.f0Hz = 0;
    this.periodSamples = 0;
    if (++this.unvoicedFrames > TRACKING_MEMORY_FRAMES) this.trackedLag = 0;
  }
}

/**
 * How good a shorter `candidate` must be, relative to the `reference` it would replace, to
 * be taken as the period.
 */
function acceptance(candidate: number, reference: number, tracked: number): number {
  if (candidate === tracked) return TRACKED_ACCEPTANCE;
  if (reference === tracked) return DEPARTURE_ACCEPTANCE;
  return PERIOD_ACCEPTANCE;
}
