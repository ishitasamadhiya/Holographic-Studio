import { describe, expect, it } from 'vitest';
import { ExtraGestureDetector, type ExtraGestureEvent } from './extraGestures';
import { GesturePipeline } from './gesturePipeline';
import { syntheticFrame, syntheticHand, type SyntheticHandOptions } from './testing/syntheticHand';
import type { RawHand } from './types';

const FRAME_MS = 1000 / 30;

interface Fired {
  timeMs: number;
  event: ExtraGestureEvent;
}

/** Runs the pipeline and the detector together at 30 fps, as the app does. */
function detect(durationMs: number, handsAt: (timeMs: number) => RawHand[]): Fired[] {
  const pipeline = new GesturePipeline();
  const detector = new ExtraGestureDetector();
  const fired: Fired[] = [];
  for (let timeMs = 0; timeMs < durationMs; timeMs += FRAME_MS) {
    const raw = syntheticFrame(timeMs, handsAt(timeMs));
    for (const event of detector.update(pipeline.update(raw), raw)) fired.push({ timeMs, event });
  }
  return fired;
}

const victory = (options: SyntheticHandOptions = {}): RawHand =>
  syntheticHand({ closure: 1, fingerClosure: { index: 0, middle: 0 }, ...options });
const rightFist = (): RawHand =>
  syntheticHand({ side: 'right', closure: 1, centre: { x: 0.3, y: 0.5 } });
const leftFist = (): RawHand =>
  syntheticHand({ side: 'left', closure: 1, centre: { x: 0.7, y: 0.5 } });
const openHand = (options: SyntheticHandOptions = {}): RawHand =>
  syntheticHand({ closure: 0, ...options });

describe('ExtraGestureDetector — victory sign', () => {
  it('toggles the reverb once after the sign is held for about 0.8 s', () => {
    const fired = detect(4000, (timeMs) => [timeMs < 500 ? openHand() : victory()]);
    expect(fired.map((entry) => entry.event)).toEqual(['toggle-reverb']);
    expect(fired[0]?.timeMs).toBeGreaterThanOrEqual(500 + 800 - FRAME_MS);
    expect(fired[0]?.timeMs).toBeLessThan(500 + 800 + 3 * FRAME_MS);
  });

  it('works with either hand and at any angle', () => {
    const fired = detect(1500, () => [victory({ side: 'left', rollDeg: 35, pitchDeg: 20 })]);
    expect(fired.map((entry) => entry.event)).toEqual(['toggle-reverb']);
  });

  it('ignores a sign that is only flashed', () => {
    const fired = detect(3000, (timeMs) => [
      timeMs >= 500 && timeMs < 1100 ? victory() : openHand(),
    ]);
    expect(fired).toEqual([]);
  });

  it('is not fooled by other poses', () => {
    const poses: RawHand[] = [
      openHand(),
      syntheticHand({ closure: 1 }),
      syntheticHand({ closure: 1, fingerClosure: { index: 0 } }),
      syntheticHand({ closure: 1, fingerClosure: { index: 0, middle: 0, ring: 0 } }),
      syntheticHand({ closure: 1, fingerClosure: { index: 0, pinky: 0 } }),
    ];
    for (const pose of poses) {
      expect(detect(2000, () => [pose])).toEqual([]);
    }
  });

  it('rides through flickering detections', () => {
    // Every seventh frame the tracker misses the hand or misreads the pose.
    const fired = detect(1500, (timeMs) => {
      const frame = Math.round(timeMs / FRAME_MS);
      if (frame % 14 === 6) return [];
      if (frame % 14 === 13) return [openHand()];
      return [victory()];
    });
    expect(fired.map((entry) => entry.event)).toEqual(['toggle-reverb']);
  });

  it('needs the sign to be released before it can toggle again', () => {
    const heldForever = detect(8000, () => [victory()]);
    expect(heldForever).toHaveLength(1);

    const twice = detect(8000, (timeMs) => [
      timeMs >= 1500 && timeMs < 4000 ? openHand() : victory(),
    ]);
    expect(twice.map((entry) => entry.event)).toEqual(['toggle-reverb', 'toggle-reverb']);
    expect(twice[1]?.timeMs).toBeGreaterThanOrEqual(4000 + 800 - FRAME_MS);
  });

  it('ignores a sign that is mostly outside the picture', () => {
    const fired = detect(2000, () => [victory({ centre: { x: 0.5, y: 0.02 } })]);
    expect(fired).toEqual([]);
  });
});

describe('ExtraGestureDetector — both fists', () => {
  it('toggles recording once after both fists are held for about 1.5 s', () => {
    const fired = detect(6000, (timeMs) =>
      timeMs < 1000
        ? [openHand({ side: 'right', centre: { x: 0.3, y: 0.5 } }), leftFist()]
        : [rightFist(), leftFist()],
    );
    expect(fired.map((entry) => entry.event)).toEqual(['toggle-recording']);
    expect(fired[0]?.timeMs).toBeGreaterThanOrEqual(1000 + 1500 - FRAME_MS);
    expect(fired[0]?.timeMs).toBeLessThan(1000 + 1500 + 250);
  });

  it('does nothing for a single fist, however long it is held', () => {
    expect(detect(5000, () => [rightFist()])).toEqual([]);
    expect(
      detect(5000, () => [rightFist(), openHand({ side: 'left', centre: { x: 0.7, y: 0.5 } })]),
    ).toEqual([]);
  });

  it('does nothing when the fists are let go too soon', () => {
    const fired = detect(4000, (timeMs) =>
      timeMs < 1200
        ? [rightFist(), leftFist()]
        : [openHand({ side: 'right', centre: { x: 0.3, y: 0.5 } }), leftFist()],
    );
    expect(fired).toEqual([]);
  });

  it('does not count a fist whose hand has gone missing', () => {
    // Both fists for 1 s, then the right hand leaves the picture: its held value is still 0,
    // but a held hand is not a deliberate pose.
    const fired = detect(4000, (timeMs) =>
      timeMs < 1000 ? [rightFist(), leftFist()] : [leftFist()],
    );
    expect(fired).toEqual([]);
  });
});

describe('ExtraGestureDetector — the tracker goes quiet', () => {
  /** Runs pipeline and detector over the given frame times only. */
  function detectAt(timesMs: number[], hands: () => RawHand[]): ExtraGestureEvent[] {
    const pipeline = new GesturePipeline();
    const detector = new ExtraGestureDetector();
    return timesMs.flatMap((timeMs) => {
      const raw = syntheticFrame(timeMs, hands());
      return detector.update(pipeline.update(raw), raw);
    });
  }

  it('does not toggle anything on sightings that are seconds apart', () => {
    // The display slept, or the camera restarted: a pose seen before and after such a gap was
    // not seen being held. A stray toggle here would start or stop a take.
    const sparse = [0, FRAME_MS, 2 * FRAME_MS, 3000, 3000 + FRAME_MS, 7000, 7000 + FRAME_MS];
    expect(detectAt(sparse, () => [victory()])).toEqual([]);
    expect(detectAt(sparse, () => [rightFist(), leftFist()])).toEqual([]);
  });

  it('still recognises a pose that is held on after the gap', () => {
    const times = [0, FRAME_MS, 2 * FRAME_MS];
    for (let timeMs = 3000; timeMs < 5500; timeMs += FRAME_MS) times.push(timeMs);
    expect(detectAt(times, () => [victory()])).toEqual(['toggle-reverb']);
    expect(detectAt(times, () => [rightFist(), leftFist()])).toEqual(['toggle-recording']);
  });
});

describe('ExtraGestureDetector — reset', () => {
  it('forgets a hold in progress', () => {
    const pipeline = new GesturePipeline();
    const detector = new ExtraGestureDetector();
    const firedAt: number[] = [];
    for (let frame = 0; frame < 60; frame += 1) {
      const timeMs = frame * FRAME_MS;
      if (frame === 18) detector.reset();
      const raw = syntheticFrame(timeMs, [victory()]);
      if (detector.update(pipeline.update(raw), raw).length > 0) firedAt.push(timeMs);
    }
    // Without the reset at 0.6 s it would have fired at 0.8 s; the hold restarted instead.
    expect(firedAt).toHaveLength(1);
    expect(firedAt[0]).toBeGreaterThanOrEqual(600 + 800 - FRAME_MS);
  });
});
