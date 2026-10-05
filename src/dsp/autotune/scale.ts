import type { KeyEstimate } from '@shared/music';
import { SCALE_INTERVALS } from '@shared/music';

/** One flag per pitch class (0 = C … 11 = B): 1 when notes of that class may be targets. */
export type PitchClassMask = Uint8Array;

export function createPitchClassMask(): PitchClassMask {
  return new Uint8Array(12).fill(1);
}

/** Fills `mask` with the notes of `key`, or with all twelve semitones when `key` is null. */
export function fillPitchClassMask(mask: PitchClassMask, key: KeyEstimate | null): void {
  // The key arrives from another thread as plain data; anything unusable means "no key".
  const intervals: readonly number[] | undefined = key ? SCALE_INTERVALS[key.mode] : undefined;
  if (key === null || intervals === undefined || !Number.isFinite(key.tonic)) {
    mask.fill(1);
    return;
  }
  mask.fill(0);
  const tonic = ((Math.round(key.tonic) % 12) + 12) % 12;
  for (const interval of intervals) mask[(tonic + interval) % 12] = 1;
}

/**
 * Moves `noteMidi` by whole octaves to the one closest to `referenceMidi`, so a singer an
 * octave below (or above) the original melody is still pulled to the same note names.
 */
export function foldToNearestOctave(noteMidi: number, referenceMidi: number): number {
  return noteMidi + 12 * Math.round((referenceMidi - noteMidi) / 12);
}

/**
 * The allowed note (integer MIDI) nearest to `midi`; NaN when `midi` is not a finite number.
 *
 * `heldNote` is the note currently being targeted (NaN = none): its distance is reduced by
 * `hysteresis` semitones, so the result only changes once the pitch is clearly closer to
 * another note. An exact tie goes to the lower note. Falls back to the nearest semitone if
 * the mask allows nothing.
 */
export function nearestAllowedNote(
  midi: number,
  mask: PitchClassMask,
  heldNote: number,
  hysteresis: number,
): number {
  if (!Number.isFinite(midi)) return Number.NaN;
  const base = Math.floor(midi);
  let best = Math.round(midi);
  let bestCost = Infinity;
  // Any non-empty mask has a note within six semitones on one side or the other.
  for (let note = base - 6; note <= base + 7; note++) {
    if (mask[((note % 12) + 12) % 12] !== 1) continue;
    const distance = Math.abs(midi - note);
    const cost = note === heldNote ? distance - hysteresis : distance;
    if (cost < bestCost) {
      bestCost = cost;
      best = note;
    }
  }
  return best;
}
