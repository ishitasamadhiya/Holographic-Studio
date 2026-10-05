import { describe, expect, it } from 'vitest';
import { MelodyTimeline } from './melodyTimeline';

function notes(...triples: [startSec: number, endSec: number, midi: number][]): Float32Array {
  return Float32Array.from(triples.flat());
}

/** Wraps an array so that every element read is counted. */
function countingReads(array: Float32Array): { array: Float32Array; reads: () => number } {
  let reads = 0;
  const proxy = new Proxy(array, {
    get(target, property) {
      if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
      return Reflect.get(target, property);
    },
  });
  return { array: proxy, reads: () => reads };
}

describe('MelodyTimeline', () => {
  const melody = notes([1, 1.5, 60], [1.5, 2, 62], [2.5, 3, 67], [3, 3.2, 65]);

  it('exposes the notes of the flat triple array', () => {
    const timeline = new MelodyTimeline();
    expect(timeline.noteCount).toBe(0);
    timeline.setNotes(melody);
    expect(timeline.noteCount).toBe(4);
    expect(timeline.startSec(2)).toBe(2.5);
    expect(timeline.endSec(2)).toBe(3);
    expect(timeline.midi(2)).toBe(67);
  });

  it('ignores an incomplete trailing triple', () => {
    const timeline = new MelodyTimeline();
    timeline.setNotes(Float32Array.of(0, 1, 60, 1, 2));
    expect(timeline.noteCount).toBe(1);
  });

  it('seeks to the first note that has not ended yet', () => {
    const timeline = new MelodyTimeline();
    timeline.setNotes(melody);
    expect(timeline.seek(0)).toBe(0);
    expect(timeline.seek(1.2)).toBe(0);
    expect(timeline.seek(1.5)).toBe(0);
    expect(timeline.seek(1.51)).toBe(1);
    expect(timeline.seek(2.2)).toBe(2);
    expect(timeline.seek(3.1)).toBe(3);
    expect(timeline.seek(5)).toBe(4);
  });

  it('handles time jumping backwards', () => {
    const timeline = new MelodyTimeline();
    timeline.setNotes(melody);
    expect(timeline.seek(3.1)).toBe(3);
    expect(timeline.seek(1.2)).toBe(0);
    expect(timeline.seek(2.9)).toBe(2);
    expect(timeline.seek(1.7)).toBe(1);
    expect(timeline.seek(-10)).toBe(0);
    expect(timeline.seek(100)).toBe(4);
    expect(timeline.seek(2.2)).toBe(2);
  });

  it('never skips a long note that started early but is still sounding', () => {
    const overlapping = notes([0, 10, 48], [1, 1.2, 60], [2, 2.2, 62], [3, 3.2, 64]);
    const timeline = new MelodyTimeline();
    timeline.setNotes(overlapping);
    expect(timeline.seek(2.5)).toBe(0);
    expect(timeline.seek(9)).toBe(0);
    expect(timeline.seek(2.5)).toBe(0);
    expect(timeline.seek(10.5)).toBe(4);
    expect(timeline.seek(3.1)).toBe(0);
  });

  it('starts over when the notes are replaced', () => {
    const timeline = new MelodyTimeline();
    timeline.setNotes(melody);
    timeline.seek(3.1);
    timeline.setNotes(notes([0, 1, 50], [4, 5, 52]));
    expect(timeline.seek(0.5)).toBe(0);
    expect(timeline.seek(2)).toBe(1);
  });

  it('does not rescan the note list while time moves forward', () => {
    const noteCount = 10000;
    const list = new Float32Array(noteCount * 3);
    for (let i = 0; i < noteCount; i++) list.set([i * 0.5, i * 0.5 + 0.4, 60 + (i % 12)], i * 3);
    const counted = countingReads(list);
    const timeline = new MelodyTimeline();
    timeline.setNotes(counted.array);
    const readsAfterSetup = counted.reads();

    const seeks = 20000;
    for (let k = 0; k < seeks; k++) {
      const timeSec = (k / seeks) * noteCount * 0.5;
      // Note i ends at 0.5·i + 0.4, so the first one still sounding is ceil((t − 0.4) / 0.5).
      expect(timeline.seek(timeSec)).toBe(Math.max(0, Math.ceil((timeSec - 0.4) / 0.5)));
    }
    // One look at the current note per seek, plus one per note passed. A scan of the whole
    // list on every call would be 200 million reads.
    expect(counted.reads() - readsAfterSetup).toBeLessThan(2 * seeks + 2 * noteCount);
  });

  it('re-places the cursor after a backwards jump in logarithmic time', () => {
    const noteCount = 10000;
    const list = new Float32Array(noteCount * 3);
    for (let i = 0; i < noteCount; i++) list.set([i * 0.5, i * 0.5 + 0.4, 60], i * 3);
    const counted = countingReads(list);
    const timeline = new MelodyTimeline();
    timeline.setNotes(counted.array);
    timeline.seek(4000);
    const before = counted.reads();
    expect(timeline.seek(1234.1)).toBe(2468);
    expect(counted.reads() - before).toBeLessThan(40);
  });
});
