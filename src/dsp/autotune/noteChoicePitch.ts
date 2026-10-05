/**
 * Averaging windows of the two cascaded moving averages. Each one has zeros in its frequency
 * response at multiples of 1 / window, so 0.2 s cancels a 5 Hz vibrato exactly and 0.15 s a
 * 6.7 Hz one. Together they keep any 4.5–7 Hz vibrato to under 5% of its depth (a ±100 cent
 * vibrato leaves less than ±5 cents), where a single 0.2 s average would leave up to 20%.
 */
const FIRST_WINDOW_SEC = 0.2;
const SECOND_WINDOW_SEC = 0.15;

/**
 * An estimate is a new note, not vibrato, when it lies further from the average than the
 * pitch range averaged so far explains, by this margin and by at least the minimum below.
 * Two such estimates in a row on the same side are needed; a single one (a detector glitch)
 * is left out of the average and otherwise ignored.
 *
 * Once the average spans a vibrato cycle it sits mid-range, so half the range is all a
 * vibrato can deviate from it. Before that it may sit near one extreme, and the full range
 * is allowed. Either way a continuous vibrato can never qualify, because each estimate
 * extends the range it is judged against, however wide the vibrato is.
 */
const NOTE_CHANGE_MARGIN_SEMITONES = 0.3;
const NOTE_CHANGE_MIN_SEMITONES = 0.7;

/**
 * After an onset or a note change, averaging only starts once two consecutive estimates are
 * this close: the pitch has landed, so scoops, glides and onset glitches are not averaged.
 * (A 2 semitone glide over 50 ms moves 0.2 semitones per 5 ms estimate; a ±50 cent, 5.5 Hz
 * vibrato at most 0.09.)
 */
const LANDED_STEP_SEMITONES = 0.1;

/**
 * The pitch the autotune chooses its target NOTE from: the sung pitch with the vibrato
 * averaged out, so a singer whose vibrato swings across the midpoint between two notes keeps
 * one target. (The correction itself always follows the instantaneous pitch.)
 *
 * The full average lags by about 0.18 s, so real note changes are detected separately: a
 * pitch outside the range the voice has covered restarts the average, and until the new
 * pitch has landed the value simply follows the sung pitch. Until the average holds both
 * full windows its value is the plain mean of what has been averaged so far.
 *
 * Fed once per pitch estimate with the estimates of one sung phrase; call `restart` between
 * phrases. Fixed-size buffers; nothing is allocated after construction.
 */
export class NoteChoicePitch {
  /** The pitch to choose the note from, as a fractional MIDI note; NaN before any estimate. */
  value = Number.NaN;
  /**
   * True only after the push at which the average first covers both full windows since the
   * pitch landed: the moment its value is vibrato-free and a held note is worth re-deciding.
   */
  settledNow = false;
  /**
   * True when the latest estimate was left out as a possible new note awaiting confirmation:
   * neither the old note nor the new one can be trusted as the target for it.
   */
  uncertain = false;

  private readonly firstLength: number = 0;
  private readonly secondLength: number = 0;
  /** Averaged estimates, newest at `rawIndex`: enough for both windows together. */
  private readonly raw: Float64Array;
  /** Recent outputs of the first average, newest at `firstIndex`. */
  private readonly firstAverages: Float64Array;
  private rawIndex = 0;
  private firstIndex = 0;
  /** Estimates averaged since the pitch landed (capped at the ring size). */
  private rawCount = 0;
  private firstCount = 0;
  private settled = false;
  private landed = false;
  private previousMidi = Number.NaN;

  /** Plain mean of the averaged estimates (it always lies inside their range). */
  private spanMean = 0;
  /** Half of max − min of the averaged estimates. */
  private halfRange = 0;
  /** Side (+1 above, -1 below, 0 none) of the previous estimate if it looked like a new note. */
  private excursionSide = 0;

  constructor(estimatesPerSecond: number) {
    this.firstLength = Math.max(1, Math.round(FIRST_WINDOW_SEC * estimatesPerSecond));
    this.secondLength = Math.max(1, Math.round(SECOND_WINDOW_SEC * estimatesPerSecond));
    this.raw = new Float64Array(this.firstLength + this.secondLength - 1);
    this.firstAverages = new Float64Array(this.secondLength);
  }

  /** Forgets everything: the next estimate starts a new phrase. */
  restart(): void {
    this.restartAverage();
    this.previousMidi = Number.NaN;
    this.value = Number.NaN;
  }

  /** Adds the next pitch estimate (fractional MIDI) and updates `value`. */
  push(midi: number): void {
    const previous = this.previousMidi;
    this.previousMidi = midi;
    this.settledNow = false;
    this.uncertain = false;

    if (this.landed && this.isExcursion(midi)) return;
    if (!this.landed) {
      this.landed = Math.abs(midi - previous) <= LANDED_STEP_SEMITONES;
      if (!this.landed) {
        this.value = midi;
        return;
      }
    }
    this.accumulate(midi);
  }

  /**
   * True when `midi` lies clearly outside the recent range: it is then left out of the
   * average. The second such estimate in a row on the same side is a note change, and the
   * average restarts.
   */
  private isExcursion(midi: number): boolean {
    const range = this.rawCount < this.firstLength ? 2 * this.halfRange : this.halfRange;
    const limit = Math.max(NOTE_CHANGE_MIN_SEMITONES, range + NOTE_CHANGE_MARGIN_SEMITONES);
    const deviation = midi - this.spanMean;
    const side = deviation > limit ? 1 : deviation < -limit ? -1 : 0;
    if (side !== 0 && side === this.excursionSide) {
      this.restartAverage();
      // Not landed yet: the value follows the sung pitch until it settles.
      this.value = midi;
      return true;
    }
    this.excursionSide = side;
    this.uncertain = side !== 0;
    return this.uncertain;
  }

  private restartAverage(): void {
    this.rawCount = 0;
    this.firstCount = 0;
    this.excursionSide = 0;
    this.landed = false;
    this.settled = false;
    this.settledNow = false;
    this.uncertain = false;
  }

  private accumulate(midi: number): void {
    const raw = this.raw;
    this.rawIndex = this.rawIndex + 1 === raw.length ? 0 : this.rawIndex + 1;
    raw[this.rawIndex] = midi;
    if (this.rawCount < raw.length) this.rawCount++;
    this.spanMean = averageOfNewest(raw, this.rawIndex, this.rawCount);
    this.measureRange();

    const firstAverages = this.firstAverages;
    this.firstIndex = this.firstIndex + 1 === firstAverages.length ? 0 : this.firstIndex + 1;
    firstAverages[this.firstIndex] = averageOfNewest(
      raw,
      this.rawIndex,
      Math.min(this.rawCount, this.firstLength),
    );
    if (this.firstCount < firstAverages.length) this.firstCount++;

    // Once the ring is full, every first-stage average in the second stage covers a full
    // window and the cascade is complete.
    const full = this.rawCount === raw.length;
    this.value = full
      ? averageOfNewest(firstAverages, this.firstIndex, firstAverages.length)
      : this.spanMean;
    this.settledNow = full && !this.settled;
    this.settled = full;
  }

  private measureRange(): void {
    const raw = this.raw;
    let index = this.rawIndex;
    let lowest = raw[index]!;
    let highest = lowest;
    for (let n = 1; n < this.rawCount; n++) {
      index = index === 0 ? raw.length - 1 : index - 1;
      const value = raw[index]!;
      if (value < lowest) lowest = value;
      if (value > highest) highest = value;
    }
    this.halfRange = 0.5 * (highest - lowest);
  }
}

/** Mean of the `count` newest values of a ring buffer whose newest value is at `newest`. */
function averageOfNewest(ring: Float64Array, newest: number, count: number): number {
  let sum = 0;
  let index = newest;
  for (let n = 0; n < count; n++) {
    sum += ring[index]!;
    index = index === 0 ? ring.length - 1 : index - 1;
  }
  return sum / count;
}
