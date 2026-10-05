import type { PitchTargetData } from '@shared/music';
import { MelodyTimeline } from './melodyTimeline';
import {
  createPitchClassMask,
  fillPitchClassMask,
  foldToNearestOctave,
  nearestAllowedNote,
} from './scale';

/**
 * Melody notes are considered when they sound within this long before or after the current
 * song position: singers are never exactly on the grid, and neither is the analysis.
 */
export const MELODY_WINDOW_SEC = 0.15;

/**
 * A melody note only becomes the target when the singer is within this many semitones of it
 * (in the singer's own octave). Further away they are singing something else — a harmony, an
 * ad-lib — and dragging them to the melody would sound wrong.
 */
export const MELODY_PULL_RANGE_SEMITONES = 2.5;

/**
 * Advantage, in semitones, given to the note that is already the target. Between two
 * neighbouring semitones the switch therefore happens 60 cents away from the held note
 * instead of 50, so a pitch resting on the boundary cannot make the target flip-flop.
 * Deliberately small: a larger value would let a note the singer merely glided through keep
 * hold of a pitch that ends up 30–40 cents flat of the next one.
 */
export const TARGET_HYSTERESIS_SEMITONES = 0.2;

/** Which rule produced the current target. */
export type TargetSource = 'melody' | 'scale' | 'chromatic';

/**
 * Decides which note the autotune should pull the singer toward:
 *
 *   1. the nearest reference-melody note sounding around the current song position, folded
 *      into the singer's octave, if the singer is within the pull range of it;
 *   2. otherwise the nearest note of the song's key;
 *   3. otherwise (no key) the nearest semitone.
 *
 * All notes sit on the song's own tuning grid (`tuningCents` away from A = 440 Hz). The only
 * state is the note currently held (for hysteresis) and the melody cursor.
 */
export class PitchTargetSelector {
  private readonly timeline = new MelodyTimeline();
  private readonly scaleMask = createPitchClassMask();
  private hasKey = false;
  private tuningSemitones = 0;
  /** Target currently held, as a note on the song's tuning grid. NaN = none. */
  private heldNote = Number.NaN;
  private lastSource: TargetSource = 'chromatic';

  /** Rule that produced the most recent target. */
  get source(): TargetSource {
    return this.lastSource;
  }

  /** Replaces the targets. Not for the audio thread's hot path (it scans the note list once). */
  setTargets(targets: PitchTargetData | null): void {
    this.timeline.setNotes(targets?.notes ?? new Float32Array(0));
    fillPitchClassMask(this.scaleMask, targets?.key ?? null);
    this.hasKey = targets?.key != null;
    const tuningCents = targets?.tuningCents ?? 0;
    this.tuningSemitones = Number.isFinite(tuningCents) ? tuningCents / 100 : 0;
    this.heldNote = Number.NaN;
  }

  /** Forgets the held note, e.g. after a pause in the singing. */
  reset(): void {
    this.heldNote = Number.NaN;
  }

  /**
   * Returns the target pitch as a fractional MIDI note number (tuning offset included).
   *
   * `sungMidi` is the singer's pitch. `songPositionSec` is the position on the song clock, or
   * NaN when no song is playing, in which case the melody is ignored. Returns NaN, and keeps
   * the held note, when `sungMidi` is not a finite number.
   */
  select(sungMidi: number, songPositionSec: number): number {
    if (!Number.isFinite(sungMidi)) return Number.NaN;
    const sung = sungMidi - this.tuningSemitones;
    const held = this.heldNote;
    let target = Number.NaN;

    if (!Number.isNaN(songPositionSec) && this.timeline.noteCount > 0) {
      const timeline = this.timeline;
      const fromSec = songPositionSec - MELODY_WINDOW_SEC;
      const toSec = songPositionSec + MELODY_WINDOW_SEC;
      const count = timeline.noteCount;
      let bestCost = Infinity;
      for (let i = timeline.seek(fromSec); i < count && timeline.startSec(i) <= toSec; i++) {
        if (timeline.endSec(i) < fromSec) continue;
        const note = foldToNearestOctave(timeline.midi(i), sung);
        const distance = Math.abs(note - sung);
        const cost = note === held ? distance - TARGET_HYSTERESIS_SEMITONES : distance;
        if (cost < bestCost) {
          bestCost = cost;
          target = note;
        }
      }
      // The held note's advantage applies here too, so the edge of the pull range is as
      // stable as the boundary between two notes.
      if (bestCost > MELODY_PULL_RANGE_SEMITONES) target = Number.NaN;
    }

    if (Number.isNaN(target)) {
      target = nearestAllowedNote(sung, this.scaleMask, held, TARGET_HYSTERESIS_SEMITONES);
      this.lastSource = this.hasKey ? 'scale' : 'chromatic';
    } else {
      this.lastSource = 'melody';
    }

    this.heldNote = target;
    return target + this.tuningSemitones;
  }
}
