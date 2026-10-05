import { describe, expect, it } from 'vitest';
import { HoldTrigger } from './holdTrigger';

const FRAME_MS = 1000 / 30;

/** Feeds the trigger at 30 fps and returns the times (ms) at which it fired. */
function firings(
  trigger: HoldTrigger,
  durationMs: number,
  isActive: (timeMs: number) => boolean,
): number[] {
  const fired: number[] = [];
  for (let timeMs = 0; timeMs < durationMs; timeMs += FRAME_MS) {
    if (trigger.update(isActive(timeMs), timeMs)) fired.push(timeMs);
  }
  return fired;
}

describe('HoldTrigger', () => {
  const options = { holdMs: 800, cooldownMs: 1500 };

  it('fires once, when the pose has been held long enough', () => {
    const fired = firings(new HoldTrigger(options), 5000, (timeMs) => timeMs >= 1000);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBeGreaterThanOrEqual(1800);
    expect(fired[0]).toBeLessThan(1800 + 2 * FRAME_MS);
  });

  it('does not fire for a pose that is dropped too early', () => {
    const fired = firings(
      new HoldTrigger(options),
      3000,
      (timeMs) => timeMs >= 1000 && timeMs < 1700,
    );
    expect(fired).toEqual([]);
  });

  it('does not add up separate short holds', () => {
    const fired = firings(new HoldTrigger(options), 6000, (timeMs) => timeMs % 1000 < 600);
    expect(fired).toEqual([]);
  });

  it('tolerates brief flicker inside a hold', () => {
    // Two single-frame dropouts and one three-frame dropout during the hold.
    const dropouts = [6, 13, 18, 19, 20];
    const fired = firings(new HoldTrigger(options), 3000, (timeMs) => {
      const frame = Math.round(timeMs / FRAME_MS);
      return !dropouts.includes(frame);
    });
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBeGreaterThanOrEqual(800);
    expect(fired[0]).toBeLessThan(800 + 2 * FRAME_MS);
  });

  it('restarts the hold after a real gap', () => {
    const fired = firings(
      new HoldTrigger(options),
      3000,
      (timeMs) => timeMs < 500 || timeMs >= 800,
    );
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBeGreaterThanOrEqual(1600);
  });

  it('fires again only after the pose is released and the cooldown has passed', () => {
    // Held 0–1.2 s (fires at 0.8 s), released, struck again from 1.5 s: still cooling down
    // until 2.3 s, so the second hold completes at 3.1 s.
    const fired = firings(
      new HoldTrigger(options),
      6000,
      (timeMs) => timeMs < 1200 || timeMs >= 1500,
    );
    expect(fired).toHaveLength(2);
    expect(fired[1]).toBeGreaterThanOrEqual(800 + 1500 + 800 - 2 * FRAME_MS);
    expect(fired[1]).toBeLessThan(800 + 1500 + 800 + 3 * FRAME_MS);
  });

  it('can fire again straight after a release once the cooldown is long past', () => {
    const fired = firings(
      new HoldTrigger(options),
      8000,
      (timeMs) => timeMs < 1000 || (timeMs >= 5000 && timeMs < 6000),
    );
    expect(fired).toHaveLength(2);
    expect(fired[1]).toBeGreaterThanOrEqual(5800);
    expect(fired[1]).toBeLessThan(5800 + 2 * FRAME_MS);
  });

  it('does not take two sightings with nothing in between for a hold', () => {
    // The tracker went quiet (display asleep, camera restarting): nobody saw the pose held.
    const blind = new HoldTrigger(options);
    expect(blind.update(true, 0)).toBe(false);
    expect(blind.update(true, 5000)).toBe(false);

    // The hold starts over at the second sighting and then completes normally.
    const resumed = new HoldTrigger(options);
    const fired: number[] = [];
    resumed.update(true, 0);
    for (let timeMs = 5000; timeMs < 7000; timeMs += FRAME_MS) {
      if (resumed.update(true, timeMs)) fired.push(timeMs);
    }
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBeGreaterThanOrEqual(5800);
    expect(fired[0]).toBeLessThan(5800 + 2 * FRAME_MS);
  });

  it('does not fire a second time when a pose held through a blind gap is still there', () => {
    const trigger = new HoldTrigger(options);
    const fired: number[] = [];
    const feed = (fromMs: number, toMs: number): void => {
      for (let timeMs = fromMs; timeMs < toMs; timeMs += FRAME_MS) {
        if (trigger.update(true, timeMs)) fired.push(timeMs);
      }
    };
    feed(0, 1000);
    // Ten seconds without a single update, then the same pose is still being held.
    feed(11_000, 14_000);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBeLessThan(1000);
  });

  it('bridges one missed detection at 10 frames per second, but not two', () => {
    const slowFrameMs = 100;
    const firedWith = (missedFrames: number[]): number[] => {
      const trigger = new HoldTrigger(options);
      const fired: number[] = [];
      for (let frame = 0; frame < 30; frame += 1) {
        if (trigger.update(!missedFrames.includes(frame), frame * slowFrameMs)) {
          fired.push(frame * slowFrameMs);
        }
      }
      return fired;
    };
    expect(firedWith([3, 6])).toEqual([800]);
    // Two in a row is 300 ms without the pose: the hold starts again at 500 ms.
    expect(firedWith([3, 4])).toEqual([1300]);
  });

  it('ignores an update whose time is not a number', () => {
    const trigger = new HoldTrigger(options);
    expect(trigger.update(true, Number.NaN)).toBe(false);
    const fired = firings(trigger, 2000, () => true);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBeGreaterThanOrEqual(800);
    expect(fired[0]).toBeLessThan(800 + 2 * FRAME_MS);
    expect(trigger.update(true, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('starts afresh after reset', () => {
    const trigger = new HoldTrigger(options);
    const fired: number[] = [];
    for (let frame = 0; frame < 60; frame += 1) {
      // Reset at 0.6 s, just before the hold would have completed.
      if (frame === 18) trigger.reset();
      if (trigger.update(true, frame * FRAME_MS)) fired.push(frame * FRAME_MS);
    }
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBeGreaterThanOrEqual(600 + 800 - 1);
    expect(fired[0]).toBeLessThan(600 + 800 + 2 * FRAME_MS);
  });
});
