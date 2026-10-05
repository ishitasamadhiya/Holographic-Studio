import { describe, expect, it } from 'vitest';
import { NoteChoicePitch } from './noteChoicePitch';

const RATE = 200;

/** Feeds `seconds` of estimates of `midiAt(t)` and returns the value after each one. */
function feed(choice: NoteChoicePitch, seconds: number, midiAt: (t: number) => number, t0 = 0) {
  const values: number[] = [];
  for (let n = 0; n < Math.round(seconds * RATE); n++) {
    choice.push(midiAt(t0 + n / RATE));
    values.push(choice.value);
  }
  return values;
}

const vibrato = (center: number, cents: number, hz: number) => (t: number) =>
  center + (cents / 100) * Math.sin(2 * Math.PI * hz * t);

describe('NoteChoicePitch', () => {
  it('cancels vibrato of 4.5 to 6.5 Hz once settled, up to ±100 cents', () => {
    for (const hz of [4.5, 5.5, 6.5]) {
      for (const cents of [35, 60, 100]) {
        for (const phase of [0, 0.3, 0.7]) {
          const choice = new NoteChoicePitch(RATE);
          const values = feed(choice, 2, (t) => vibrato(56.6, cents, hz)(t + phase / hz));
          const settled = values.slice(Math.round(0.5 * RATE));
          const worst = Math.max(...settled.map((value) => Math.abs(value - 56.6)));
          // Under 6% of the vibrato depth: it never comes near the 56.5 boundary.
          expect(worst, `${cents}c at ${hz} Hz`).toBeLessThan(0.06 * (cents / 100));
        }
      }
    }
  });

  it('follows a note change within a few estimates of the new pitch landing', () => {
    for (const step of [-5, -1, 0.8, 2, 7]) {
      const choice = new NoteChoicePitch(RATE);
      feed(choice, 0.5, vibrato(60, 30, 5.5));
      const after = feed(choice, 0.3, (t) => 60 + step + 0.3 * Math.sin(2 * Math.PI * 5.5 * t));
      // The value is the new note's pitch (within its vibrato) 20 ms after the jump…
      expect(Math.abs(after[4]! - (60 + step)), `step ${step}`).toBeLessThan(0.35);
      // …and never strays back toward the old note.
      for (const value of after.slice(4)) {
        expect(Math.abs(value - (60 + step)), `step ${step}`).toBeLessThan(0.35);
      }
    }
  });

  it('does not average a glide into the new note', () => {
    const choice = new NoteChoicePitch(RATE);
    // 57 held, then a 50 ms glide to 59, then 59 held.
    const midiAt = (t: number) => (t < 0.5 ? 57 : t < 0.55 ? 57 + (2 * (t - 0.5)) / 0.05 : 59);
    const values = feed(choice, 0.7, midiAt);
    // From 10 ms after the glide ends the value is the new note, not something in between.
    for (const value of values.slice(Math.round(0.56 * RATE))) expect(value).toBeCloseTo(59, 6);
  });

  it('ignores a single stray estimate, at the start of a phrase or within it', () => {
    const choice = new NoteChoicePitch(RATE);
    // An onset glitch (the detector locked on a formant for one estimate), then a steady note.
    choice.push(77.6);
    const values = feed(choice, 0.6, (t) => (Math.abs(t - 0.4) < 0.001 ? 70.3 : 58.3));
    for (const value of values.slice(1)) expect(value).toBeCloseTo(58.3, 6);
  });

  it('reports settling once per landed note, and restarts on request', () => {
    const choice = new NoteChoicePitch(RATE);
    let settledAt: number[] = [];
    const watch = (seconds: number, midiAt: (t: number) => number) => {
      for (let n = 0; n < Math.round(seconds * RATE); n++) {
        choice.push(midiAt(n / RATE));
        if (choice.settledNow) settledAt.push(n);
      }
    };
    watch(1, () => 60);
    // 69 estimates (0.345 s) averaged; the first estimate only shows where the pitch is.
    expect(settledAt).toEqual([69]);
    settledAt = [];
    watch(1, () => 64);
    expect(settledAt).toHaveLength(1);

    choice.restart();
    expect(Number.isNaN(choice.value)).toBe(true);
    choice.push(50);
    expect(choice.value).toBe(50);
  });
});
