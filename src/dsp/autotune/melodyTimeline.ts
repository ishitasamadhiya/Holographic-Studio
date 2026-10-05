const FIELDS_PER_NOTE = 3;
const EMPTY_NOTES = new Float32Array(0);

/**
 * The reference melody as the audio thread sees it: flat [startSec, endSec, midi] triples
 * sorted by start time (PitchTargetData.notes), with a cursor for cheap sequential lookup.
 *
 * During playback time only moves forward, so `seek` just advances the cursor past the notes
 * that have ended — amortized O(1) per call. When time jumps backwards (seek, restart, loop)
 * the cursor is re-placed with a binary search.
 */
export class MelodyTimeline {
  private notes: Float32Array = EMPTY_NOTES;
  private count = 0;
  private cursor = 0;
  private lastFromSec = -Infinity;
  private longestNoteSec = 0;

  get noteCount(): number {
    return this.count;
  }

  /** Replaces the melody. Keeps a reference to `notes`; it must not be modified afterwards. */
  setNotes(notes: Float32Array): void {
    this.notes = notes;
    this.count = Math.floor(notes.length / FIELDS_PER_NOTE);
    this.cursor = 0;
    this.lastFromSec = -Infinity;
    let longest = 0;
    for (let i = 0; i < this.count; i++) {
      longest = Math.max(longest, this.endSec(i) - this.startSec(i));
    }
    this.longestNoteSec = longest;
  }

  startSec(index: number): number {
    return this.notes[index * FIELDS_PER_NOTE]!;
  }

  endSec(index: number): number {
    return this.notes[index * FIELDS_PER_NOTE + 1]!;
  }

  midi(index: number): number {
    return this.notes[index * FIELDS_PER_NOTE + 2]!;
  }

  /**
   * Returns the index of the first note that can still be sounding at or after `fromSec`:
   * every note before it has ended earlier. Notes from that index on are in start order, so
   * a caller scans forward until a note starts after the end of its window.
   */
  seek(fromSec: number): number {
    if (fromSec < this.lastFromSec) {
      // A note can only reach `fromSec` if it starts within the longest note's length of it.
      this.cursor = this.firstNoteStartingAtOrAfter(fromSec - this.longestNoteSec);
    }
    this.lastFromSec = fromSec;
    let cursor = this.cursor;
    while (cursor < this.count && this.endSec(cursor) < fromSec) cursor++;
    this.cursor = cursor;
    return cursor;
  }

  private firstNoteStartingAtOrAfter(timeSec: number): number {
    let low = 0;
    let high = this.count;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.startSec(middle) < timeSec) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
