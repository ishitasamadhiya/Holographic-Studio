import { MirroredHistory } from '../history';
import { clamp, semitonesToRatio } from '../math';
import { SpliceSearch } from './spliceSearch';

/** Delay between input and output while nothing is being shifted. */
const NOMINAL_DELAY_SEC = 0.005;

const DEFAULT_MAX_SHIFT_SEMITONES = 4;

/** Periods outside this range are clamped (60 Hz .. 1100 Hz). */
const MIN_PERIOD_HZ = 1100;
const MAX_PERIOD_HZ = 60;

/** Period assumed until the first real one arrives. */
const INITIAL_PERIOD_HZ = 200;

/**
 * The read delay may wander over this many periods before it is spliced back. It has to be
 * more than 1: a splice moves the delay by one period, and the extra quarter is the
 * hysteresis that stops a ratio hovering around 1 from splicing back and forth.
 */
const WINDOW_PERIODS = 1.25;

/** Cross-fade length as a fraction of the period, and its limits. */
const FADE_PERIODS = 0.5;
const MIN_FADE_SEC = 0.0007;
const MAX_FADE_SEC = 0.0055;

/** Length of the audio compared by the splice search: one period, within these limits. */
const MIN_MATCH_SEC = 0.0027;
const MAX_MATCH_SEC = 0.0107;
/** Long comparisons are subsampled to about this many products per lag. */
const MATCH_TARGET_TERMS = 256;

/** The 4-point interpolator needs two samples ahead of the read position. */
const MIN_READ_DELAY = 2;

/**
 * While idle (ratio exactly 1) a fractional delay is eased onto the nearest whole sample at
 * this rate, in samples per sample. That is a pitch offset of under one cent for at most
 * ~20 ms, after which the shifter is bit-transparent again.
 */
const IDLE_SETTLE_STEP = 1 / 2048;

/**
 * While idle on a pitched voice, a delay further than this many periods from the nominal one
 * is brought back by one pitch-synchronous splice. More than half a period, so the splice
 * always lands closer to nominal (the splice search may stretch the period by 4%) and can
 * never be undone by the next one.
 */
const RECENTER_PERIODS = 0.6;

/** Frames handled per pass over the delay line (bounds how far ahead of the read it is filled). */
const CHUNK_FRAMES = 256;

export interface PitchShifterOptions {
  sampleRate: number;
  /** Largest shift in either direction the shifter must support. Default 4 semitones. */
  maxShiftSemitones?: number;
}

/**
 * Low-latency pitch shifter for a monophonic voice: a pitch-synchronous delay-line resampler.
 *
 * The input is written into a delay line and read back through a fractional pointer that
 * moves at `ratio` samples per sample, which transposes the audio by `ratio`. Reading faster
 * or slower than writing makes the delay shrink or grow, so whenever it leaves its window the
 * pointer jumps by exactly one pitch period — the waveform there looks the same — with a
 * short raised-cosine cross-fade. Whole periods are repeated or dropped; formants and timing
 * are untouched.
 *
 * At ratio exactly 1 nothing is interpolated or spliced and the output is the input delayed
 * by `latencySamples`. While shifting, the delay moves around that value by up to ±0.625
 * periods; for voices below ~170 Hz the window cannot be centred on 5 ms and the delay
 * averages about 1.3 ms + 0.75 periods while shifting down (9 ms at 98 Hz). Once the ratio
 * is back to 1 the delay returns: exactly to `latencySamples` as soon as the input is
 * unvoiced (`clearPeriod`), and to within ~0.6 periods of it meanwhile.
 */
export class PitchShifter {
  /** Nominal input-to-output delay in samples. */
  readonly latencySamples: number = 0;

  private readonly sampleRate: number = 0;
  private readonly minRatio: number = 0;
  private readonly maxRatio: number = 0;
  private readonly minPeriod: number = 0;
  private readonly maxPeriod: number = 0;
  private readonly minFade: number = 0;
  private readonly maxFade: number = 0;
  private readonly minMatch: number = 0;
  private readonly maxMatch: number = 0;
  private readonly maxDelay: number = 0;

  private readonly history: MirroredHistory;
  private readonly search: SpliceSearch;

  private period = 0;
  private fadeSamples = 0;
  private lowerDelay = 0;
  private upperDelay = 0;
  /** Splice-search settings for the current period (whole numbers of samples). */
  private matchLength = 0;
  private matchStride = 1;
  private searchCenter = 0;
  private searchRadius = 0;

  /** Distance from the newest input sample back to the read position, in samples. */
  private delay: number = 0;
  /** True while the delay is a whole number and the shifter is bit-transparent. */
  private settled = true;
  /** False while the input is known to have no pitch (see clearPeriod). */
  private periodic = true;

  /** Delay of the outgoing read position during a cross-fade. */
  private fadeDelay = 0;
  private fadeLength = 0;
  private fadeRemaining = 0;
  private splices = 0;

  constructor(options: PitchShifterOptions) {
    const { sampleRate } = options;
    this.sampleRate = sampleRate;
    this.maxRatio = semitonesToRatio(options.maxShiftSemitones ?? DEFAULT_MAX_SHIFT_SEMITONES);
    this.minRatio = 1 / this.maxRatio;
    this.latencySamples = Math.round(NOMINAL_DELAY_SEC * sampleRate);
    this.minPeriod = sampleRate / MIN_PERIOD_HZ;
    this.maxPeriod = sampleRate / MAX_PERIOD_HZ;
    this.minFade = Math.round(MIN_FADE_SEC * sampleRate);
    this.maxFade = Math.round(MAX_FADE_SEC * sampleRate);
    this.minMatch = Math.round(MIN_MATCH_SEC * sampleRate);
    this.maxMatch = Math.round(MAX_MATCH_SEC * sampleRate);

    const largestLower = Math.max(this.latencySamples, this.lowestSafeDelay(this.maxFade));
    // Furthest the outgoing pointer can drift during a fade on top of the widest window.
    this.maxDelay = Math.ceil(largestLower + WINDOW_PERIODS * this.maxPeriod + this.maxFade + 4);
    const maxLag = Math.ceil(this.maxPeriod) + SpliceSearch.radiusFor(this.maxPeriod) + 1;
    this.history = new MirroredHistory(this.maxDelay + this.maxMatch + maxLag + CHUNK_FRAMES + 8);
    this.search = new SpliceSearch(this.maxPeriod);

    this.delay = this.latencySamples;
    this.setPeriod(sampleRate / INITIAL_PERIOD_HZ);
  }

  /** Current input-to-output delay in samples. */
  get delaySamples(): number {
    return this.delay;
  }

  /** Number of splices performed since construction or the last reset. */
  get spliceCount(): number {
    return this.splices;
  }

  /**
   * Tells the shifter the pitch period of the incoming voice, in samples. Call it whenever a
   * new estimate is available; values that are not positive numbers are ignored, so the last
   * known period keeps being used through unvoiced sounds.
   */
  setPeriod(periodSamples: number): void {
    if (!(periodSamples > 0)) return;
    this.periodic = true;
    const period = clamp(periodSamples, this.minPeriod, this.maxPeriod);
    this.period = period;
    this.fadeSamples = clamp(Math.round(FADE_PERIODS * period), this.minFade, this.maxFade);
    this.lowerDelay = Math.max(
      this.lowestSafeDelay(this.fadeSamples),
      this.latencySamples - 0.5 * WINDOW_PERIODS * period,
    );
    this.upperDelay = this.lowerDelay + WINDOW_PERIODS * period;
    this.matchLength = clamp(Math.round(period), this.minMatch, this.maxMatch);
    this.matchStride = Math.max(1, Math.floor(this.matchLength / MATCH_TARGET_TERMS));
    this.searchCenter = Math.round(period);
    this.searchRadius = SpliceSearch.radiusFor(period);
  }

  /**
   * Tells the shifter the input has no pitch right now (unvoiced or silent), until the next
   * `setPeriod`. Splicing keeps using the last period; but once the ratio is back to 1 the
   * delay jumps straight back to `latencySamples` with a cross-fade, which needs no
   * periodicity and is inaudible on noise or silence.
   */
  clearPeriod(): void {
    this.periodic = false;
  }

  /**
   * Shifts `count` samples of `buffer` in place, starting at `offset`. `ratios[i]` is the
   * frequency ratio for the i-th of them (1 = unchanged, 2^(1/12) = one semitone up); it may
   * change freely from sample to sample and is clamped to the supported range.
   *
   * (Block-based on purpose: a per-sample method would make the JavaScript engine allocate
   * a heap number for every sample passed in and out.)
   */
  process(buffer: Float32Array, offset: number, count: number, ratios: Float32Array): void {
    for (let done = 0; done < count; done += CHUNK_FRAMES) {
      this.processChunk(buffer, offset + done, Math.min(CHUNK_FRAMES, count - done), ratios, done);
    }
  }

  private processChunk(
    buffer: Float32Array,
    offset: number,
    count: number,
    ratios: Float32Array,
    ratioOffset: number,
  ): void {
    // The whole chunk goes into the delay line first. A sample is only ever read at least
    // MIN_READ_DELAY behind "its own" write position, so nothing from its future is used.
    this.history.pushBlock(buffer, offset, count);
    const data = this.history.data;
    const firstIndex = this.history.newestIndex - count + 1;
    const { minRatio, maxRatio, maxDelay, lowerDelay, upperDelay } = this;

    let delay = this.delay;
    let settled = this.settled;
    let fadeDelay = this.fadeDelay;
    let fadeLength = this.fadeLength;
    let fadeRemaining = this.fadeRemaining;

    for (let i = 0; i < count; i++) {
      const newest = firstIndex + i;
      const requested = ratios[ratioOffset + i]!;
      // NaN fails both comparisons and ends up as 1: no shift.
      const ratio =
        requested >= minRatio ? Math.min(requested, maxRatio) : requested < minRatio ? minRatio : 1;

      // Read at `newest - delay` with 4-point, 3rd-order Hermite (Catmull-Rom) interpolation
      // between y1 (t = 0) and y2 (t = 1). At t = 0 the result is y1 exactly, which is what
      // makes a whole-sample delay bit-transparent. Written out here and below so that no
      // fractional value crosses a function call inside this loop.
      let position = newest - delay;
      let index = Math.floor(position);
      let t = position - index;
      let y0 = data[index - 1]!;
      let y1 = data[index]!;
      let y2 = data[index + 1]!;
      let y3 = data[index + 2]!;
      let output =
        (((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * t + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * t +
          0.5 * (y2 - y0)) *
          t +
        y1;

      if (fadeRemaining > 0) {
        position = newest - fadeDelay;
        index = Math.floor(position);
        t = position - index;
        y0 = data[index - 1]!;
        y1 = data[index]!;
        y2 = data[index + 1]!;
        y3 = data[index + 2]!;
        const outgoing =
          (((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * t + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * t +
            0.5 * (y2 - y0)) *
            t +
          y1;
        const progress = (fadeLength - fadeRemaining + 1) / (fadeLength + 1);
        output = outgoing + (output - outgoing) * (0.5 - 0.5 * Math.cos(Math.PI * progress));
        fadeDelay = Math.min(Math.max(fadeDelay + 1 - ratio, MIN_READ_DELAY), maxDelay);
        fadeRemaining--;
      }
      buffer[offset + i] = output;

      if (ratio === 1) {
        if (fadeRemaining === 0 && delay !== this.latencySamples) {
          this.delay = delay;
          if (this.recenter(newest)) {
            delay = this.delay;
            settled = this.settled;
            fadeDelay = this.fadeDelay;
            fadeLength = this.fadeLength;
            fadeRemaining = this.fadeRemaining;
            continue;
          }
        }
        if (!settled && fadeRemaining === 0) {
          const whole = Math.round(delay);
          if (whole - delay > IDLE_SETTLE_STEP) delay += IDLE_SETTLE_STEP;
          else if (whole - delay < -IDLE_SETTLE_STEP) delay -= IDLE_SETTLE_STEP;
          else {
            delay = whole;
            settled = true;
          }
        }
        continue;
      }

      settled = false;
      delay += 1 - ratio;
      if (fadeRemaining === 0 && (delay < lowerDelay || delay > upperDelay)) {
        this.delay = delay;
        this.splice(newest, delay < lowerDelay ? 1 : -1);
        delay = this.delay;
        fadeDelay = this.fadeDelay;
        fadeLength = this.fadeLength;
        fadeRemaining = this.fadeRemaining;
      }
      // (Math.min/max rather than assigning the limits: giving a loop variable a whole-number
      // constant makes V8 keep it as a heap object, allocated anew on every pass.)
      delay = Math.min(Math.max(delay, MIN_READ_DELAY), maxDelay);
    }

    this.delay = delay;
    this.settled = settled;
    this.fadeDelay = fadeDelay;
    this.fadeRemaining = fadeRemaining;
  }

  reset(): void {
    this.history.clear();
    this.delay = this.latencySamples;
    this.settled = true;
    this.periodic = true;
    this.fadeRemaining = 0;
    this.splices = 0;
    this.setPeriod(this.sampleRate / INITIAL_PERIOD_HZ);
  }

  /**
   * Smallest delay at which a splice may start: the outgoing pointer keeps closing in on the
   * write position for the whole fade and must not reach it.
   */
  private lowestSafeDelay(fadeSamples: number): number {
    return MIN_READ_DELAY + 1 + fadeSamples * (this.maxRatio - 1);
  }

  /**
   * At ratio 1, starts a cross-fade that brings the delay back toward `latencySamples` when
   * that is possible now; returns false otherwise. Without a pitch the jump goes all the way;
   * with one it is one pitch period (refined by the splice search) and only when the result
   * stays inside the safe window.
   */
  private recenter(newest: number): boolean {
    const offset = this.delay - this.latencySamples;
    if (!this.periodic) {
      this.fadeDelay = this.delay;
      this.delay = this.latencySamples;
      this.fadeLength = this.fadeSamples;
      this.fadeRemaining = this.fadeSamples;
      this.settled = true;
      return true;
    }
    if (offset < RECENTER_PERIODS * this.period && offset > -RECENTER_PERIODS * this.period) {
      return false;
    }
    // The splice search may make the jump a little longer than the period.
    const longestJump = this.searchCenter + this.searchRadius;
    if (offset > 0 && this.delay - longestJump < this.lowerDelay) return false;
    this.splice(newest, offset > 0 ? -1 : 1);
    this.settled = false;
    return true;
  }

  /**
   * Jumps the read position by one period: into the past when `direction` is +1 (the delay
   * grows, a period is heard twice), toward the present when it is -1 (a period is skipped).
   * `newest` is the delay-line index of the sample being processed.
   */
  private splice(newest: number, direction: 1 | -1): void {
    const matchLength = this.matchLength;
    const maxLag = this.searchCenter + this.searchRadius;

    // Centre the compared audio on the read position as far as the samples that already
    // exist allow: that is where the cross-fade is about to happen.
    const anchor = Math.round(newest - this.delay);
    const available = direction === 1 ? newest - anchor : newest - anchor - maxLag;
    const ahead = Math.min(matchLength >> 1, available);
    const anchorStart = anchor + ahead - matchLength + 1;

    const matched = this.search.find(
      this.history.data,
      anchorStart,
      matchLength,
      this.matchStride,
      direction,
      this.searchCenter,
      this.searchRadius,
    );
    this.fadeDelay = this.delay;
    this.delay += direction * (matched ? this.search.lag : this.period);
    this.fadeLength = this.fadeSamples;
    this.fadeRemaining = this.fadeSamples;
    this.splices++;
  }
}
