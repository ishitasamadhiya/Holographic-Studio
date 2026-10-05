import { describe, expect, it } from 'vitest';
import { GesturePipeline } from './gesturePipeline';
import { HOLD_DURATION_MS } from './handChannel';
import { PALM_LANDMARKS } from './handTopology';
import { measureOpenness } from './openness';
import { DEFAULT_NEUTRAL_HAND_SCALE, proximityFromScale } from './proximity';
import {
  SYNTHETIC_IMAGE_ASPECT,
  syntheticFrame,
  syntheticHand,
  type SyntheticHandOptions,
} from './testing/syntheticHand';
import type { GestureFrame, HandState, RawHand } from './types';

const FRAME_MS = 1000 / 30;

/** Feeds frames at 30 fps, starting at `startMs`, and returns every resulting gesture frame. */
function run(pipeline: GesturePipeline, frames: RawHand[][], startMs = 0): GestureFrame[] {
  return frames.map((hands, index) =>
    pipeline.update(syntheticFrame(startMs + index * FRAME_MS, hands)),
  );
}

function repeat(count: number, make: (index: number) => RawHand[]): RawHand[][] {
  return Array.from({ length: count }, (_, index) => make(index));
}

function last(frames: GestureFrame[]): GestureFrame {
  const frame = frames[frames.length - 1];
  if (!frame) throw new Error('no frames');
  return frame;
}

const rightHand = (options: SyntheticHandOptions = {}): RawHand =>
  syntheticHand({ side: 'right', centre: { x: 0.3, y: 0.5 }, ...options });
const leftHand = (options: SyntheticHandOptions = {}): RawHand =>
  syntheticHand({ side: 'left', centre: { x: 0.7, y: 0.5 }, ...options });

/** The hand with every palm landmark moved onto the wrist: a palm of no size at all. */
function withCollapsedPalm(hand: RawHand): RawHand {
  const wrist = hand.landmarks[0];
  if (!wrist) throw new Error('hand without landmarks');
  return {
    ...hand,
    landmarks: hand.landmarks.map((landmark, index) =>
      PALM_LANDMARKS.includes(index) ? { ...wrist } : landmark,
    ),
  };
}

function expectFiniteState(hand: HandState): void {
  for (const value of [hand.openness, hand.proximity, hand.scale, hand.confidence]) {
    expect(Number.isFinite(value)).toBe(true);
  }
  for (const value of [hand.openness, hand.proximity, hand.confidence]) {
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
}

describe('GesturePipeline', () => {
  it('starts with both hands lost and neutral values', () => {
    const frame = new GesturePipeline().update(syntheticFrame(0, []));
    for (const hand of [frame.left, frame.right]) {
      expect(hand.status).toBe('lost');
      expect(hand.proximity).toBe(0.5);
      expect(hand.confidence).toBe(0);
      expect(hand.landmarks).toBeNull();
    }
    expect(frame.left.side).toBe('left');
    expect(frame.right.side).toBe('right');
  });

  it('reports an open right hand and a left fist on the correct sides', () => {
    const frame = last(
      run(
        new GesturePipeline(),
        repeat(10, () => [leftHand({ closure: 1 }), rightHand({ closure: 0 })]),
      ),
    );
    expect(frame.right.status).toBe('tracking');
    expect(frame.right.openness).toBe(1);
    expect(frame.left.status).toBe('tracking');
    expect(frame.left.openness).toBe(0);
    expect(frame.timestampMs).toBeCloseTo(9 * FRAME_MS, 9);
  });

  it('tracks one hand and leaves the other lost', () => {
    const frame = last(
      run(
        new GesturePipeline(),
        repeat(5, () => [leftHand({ closure: 0.55 })]),
      ),
    );
    expect(frame.left.status).toBe('tracking');
    expect(frame.left.openness).toBeGreaterThan(0.3);
    expect(frame.left.openness).toBeLessThan(0.8);
    expect(frame.left.confidence).toBeGreaterThan(0.9);
    expect(frame.left.landmarks).toHaveLength(21);
    expect(frame.right.status).toBe('lost');
    expect(frame.right.landmarks).toBeNull();
  });

  it('maps hand scale to proximity around the neutral scale', () => {
    const proximityAt = (palmScale: number, neutral: number | null): number =>
      last(
        run(
          new GesturePipeline({ neutralHandScale: neutral }),
          repeat(5, () => [rightHand({ palmScale })]),
        ),
      ).right.proximity;

    expect(proximityAt(DEFAULT_NEUTRAL_HAND_SCALE, null)).toBeCloseTo(0.5, 6);
    expect(proximityAt(DEFAULT_NEUTRAL_HAND_SCALE * 2, null)).toBe(1);
    expect(proximityAt(DEFAULT_NEUTRAL_HAND_SCALE / 2, null)).toBe(0);
    expect(proximityAt(0.25, 0.25)).toBeCloseTo(0.5, 6);
    expect(proximityAt(0.25 * Math.SQRT2, 0.25)).toBeCloseTo(0.75, 6);
  });

  it('reports the raw hand scale for calibration', () => {
    const frame = last(
      run(
        new GesturePipeline(),
        repeat(3, () => [rightHand({ palmScale: 0.23 })]),
      ),
    );
    expect(frame.right.scale).toBeCloseTo(0.23, 6);
    expect(frame.left.scale).toBe(0);
  });

  it('applies a new neutral scale from the next frame on', () => {
    const pipeline = new GesturePipeline();
    run(
      pipeline,
      repeat(5, () => [rightHand({ palmScale: 0.3 })]),
    );
    pipeline.setNeutralHandScale(0.3);
    const calibrated = last(
      run(
        pipeline,
        repeat(20, () => [rightHand({ palmScale: 0.3 })]),
        200,
      ),
    );
    expect(calibrated.right.proximity).toBeCloseTo(0.5, 6);
    pipeline.setNeutralHandScale(null);
    const restored = last(
      run(
        pipeline,
        repeat(20, () => [rightHand({ palmScale: 0.3 })]),
        1000,
      ),
    );
    expect(restored.right.proximity).toBeGreaterThan(0.8);
  });

  it('smooths away landmark jitter while the hand is still', () => {
    // The hand trembles between slightly different half-closed poses and distances.
    const trembling = (index: number): RawHand =>
      rightHand({
        closure: 0.55 + 0.012 * Math.sin(index * 2.1),
        palmScale: 0.2 * (1 + 0.03 * Math.sin(index * 1.3)),
      });
    const span = (values: number[]): number => Math.max(...values) - Math.min(...values);

    const rawOpenness = Array.from({ length: 120 }, (_, index) =>
      measureOpenness(trembling(index)),
    );
    const rawProximity = Array.from({ length: 120 }, (_, index) =>
      proximityFromScale(0.2 * (1 + 0.03 * Math.sin(index * 1.3))),
    );
    const settled = run(
      new GesturePipeline(),
      repeat(120, (index) => [trembling(index)]),
    )
      .slice(30)
      .map((frame) => frame.right);

    // The tremor is worth about 0.07 of openness and 0.04 of proximity; a tenth gets through.
    expect(span(rawOpenness)).toBeGreaterThan(0.06);
    expect(span(settled.map((hand) => hand.openness))).toBeLessThan(span(rawOpenness) / 10);
    expect(span(rawProximity)).toBeGreaterThan(0.035);
    expect(span(settled.map((hand) => hand.proximity))).toBeLessThan(span(rawProximity) / 10);
  });

  it('follows a fast gesture within a few frames', () => {
    const pipeline = new GesturePipeline();
    run(
      pipeline,
      repeat(15, () => [rightHand({ closure: 1 })]),
    );
    // The fist opens over 200 ms.
    const opening = run(
      pipeline,
      repeat(6, (index) => [rightHand({ closure: 1 - (index + 1) / 6 })]),
      15 * FRAME_MS,
    );
    expect(last(opening).right.openness).toBeGreaterThan(0.9);
    const after = run(
      pipeline,
      repeat(3, () => [rightHand({ closure: 0 })]),
      21 * FRAME_MS,
    );
    expect(last(after).right.openness).toBe(1);
  });

  it('reaches exactly 0 and exactly 1 despite the smoothing', () => {
    const pipeline = new GesturePipeline();
    run(
      pipeline,
      repeat(10, () => [rightHand({ closure: 0.55 })]),
    );
    const closed = last(
      run(
        pipeline,
        repeat(20, () => [rightHand({ closure: 1 })]),
        400,
      ),
    );
    expect(closed.right.openness).toBe(0);
    const opened = last(
      run(
        pipeline,
        repeat(20, () => [rightHand({ closure: 0 })]),
        1200,
      ),
    );
    expect(opened.right.openness).toBe(1);
  });

  it('holds the last values when a hand disappears, then reports it lost', () => {
    const pipeline = new GesturePipeline({ neutralHandScale: 0.2 });
    const before = last(
      run(
        pipeline,
        repeat(15, () => [rightHand({ closure: 0.55, palmScale: 0.26 })]),
      ),
    );
    const goneAtMs = before.timestampMs;
    const after = run(
      pipeline,
      repeat(40, () => []),
      goneAtMs + FRAME_MS,
    );

    for (const frame of after) {
      const heldForMs = frame.timestampMs - goneAtMs;
      expect(frame.right.status).toBe(heldForMs < HOLD_DURATION_MS ? 'holding' : 'lost');
      // The values stay frozen through holding AND after loss; easing back is the resolver's job.
      expect(frame.right.openness).toBe(before.right.openness);
      expect(frame.right.proximity).toBe(before.right.proximity);
      expect(frame.right.confidence).toBe(0);
      expect(frame.right.landmarks).toBeNull();
    }
    expect(after[0]?.right.status).toBe('holding');
    expect(last(after).right.status).toBe('lost');
  });

  it('loses each hand on its own clock', () => {
    const pipeline = new GesturePipeline();
    run(
      pipeline,
      repeat(10, () => [leftHand(), rightHand()]),
    );
    // The right hand leaves first; the left one 500 ms later.
    run(
      pipeline,
      repeat(15, () => [leftHand()]),
      10 * FRAME_MS,
    );
    const frames = run(
      pipeline,
      repeat(40, () => []),
      25 * FRAME_MS,
    );

    const statusAt = (ms: number): [string, string] => {
      const frame = frames.find((candidate) => candidate.timestampMs >= ms);
      if (!frame) throw new Error(`no frame at ${ms}`);
      return [frame.left.status, frame.right.status];
    };
    const rightGoneMs = 9 * FRAME_MS;
    const leftGoneMs = 24 * FRAME_MS;
    expect(statusAt(rightGoneMs + HOLD_DURATION_MS + 40)).toEqual(['holding', 'lost']);
    expect(statusAt(leftGoneMs + HOLD_DURATION_MS + 40)).toEqual(['lost', 'lost']);
  });

  it('resumes tracking when the hand comes back during the hold', () => {
    const pipeline = new GesturePipeline();
    run(
      pipeline,
      repeat(10, () => [rightHand({ closure: 0 })]),
    );
    const gap = run(
      pipeline,
      repeat(6, () => []),
      10 * FRAME_MS,
    );
    expect(last(gap).right.status).toBe('holding');
    const back = run(
      pipeline,
      repeat(3, () => [rightHand({ closure: 0 })]),
      16 * FRAME_MS,
    );
    expect(back[0]?.right.status).toBe('tracking');
    expect(last(back).right.openness).toBe(1);
  });

  it('starts from the fresh pose, not the stale one, when a lost hand returns', () => {
    const pipeline = new GesturePipeline();
    run(
      pipeline,
      repeat(10, () => [rightHand({ closure: 0 })]),
    );
    // Gone for just long enough to be lost.
    const gone = run(
      pipeline,
      repeat(26, () => []),
      10 * FRAME_MS,
    );
    expect(last(gone).right.status).toBe('lost');

    const freshPose = rightHand({ closure: 0.6 });
    const back = run(pipeline, [[freshPose]], 36 * FRAME_MS);
    expect(back[0]?.right.status).toBe('tracking');
    // Exactly what is seen now: nothing of the old open hand is smoothed into it.
    expect(back[0]?.right.openness).toBeCloseTo(measureOpenness(freshPose), 9);
  });

  it('does not let a low-confidence detection move the values', () => {
    const pipeline = new GesturePipeline();
    const before = last(
      run(
        pipeline,
        repeat(10, () => [rightHand({ closure: 0, centre: { x: 0.3, y: 0.3 } })]),
      ),
    );
    expect(before.right.status).toBe('tracking');
    // The hand slides half out of the top of the frame while closing: an unreliable view.
    const leaving = run(
      pipeline,
      repeat(10, () => [rightHand({ closure: 1, centre: { x: 0.3, y: 0.02 } })]),
      10 * FRAME_MS,
    );
    for (const frame of leaving) {
      expect(frame.right.status).toBe('holding');
      expect(frame.right.openness).toBe(before.right.openness);
      expect(frame.right.proximity).toBe(before.right.proximity);
      expect(frame.right.confidence).toBeLessThan(0.7);
      // The landmarks are still passed on for the debug overlay.
      expect(frame.right.landmarks).toHaveLength(21);
    }
  });

  it('keeps following a fully visible hand whose left/right label turns unsure', () => {
    // A flat hand turned edge-on to the camera: in view, but the tracker's handedness score
    // drops to about 0.6 for as long as it stays turned.
    const pipeline = new GesturePipeline();
    run(
      pipeline,
      repeat(10, () => [rightHand({ closure: 0 })]),
    );
    const turned = run(
      pipeline,
      repeat(90, () => [rightHand({ closure: 1, score: 0.6 })]),
      10 * FRAME_MS,
    );
    for (const frame of turned) {
      expect(frame.right.status).toBe('tracking');
      expect(frame.left.status).toBe('lost');
    }
    expect(last(turned).right.openness).toBe(0);
  });

  it('takes on a new hand whose label is never better than unsure', () => {
    const frames = run(
      new GesturePipeline(),
      repeat(30, () => [leftHand({ closure: 0, score: 0.6 })]),
    );
    const trackedFrom = frames.findIndex((frame) => frame.left.status === 'tracking');
    // Unsure votes count for less, so it takes a few more frames than a sure hand's two.
    expect(trackedFrom).toBeGreaterThan(2);
    expect(trackedFrom).toBeLessThanOrEqual(10);
    for (const frame of frames.slice(trackedFrom)) expect(frame.left.status).toBe('tracking');
    for (const frame of frames) expect(frame.right.status).toBe('lost');
  });

  it('declares a hand lost when its detections stay unreliable', () => {
    const pipeline = new GesturePipeline();
    run(
      pipeline,
      repeat(10, () => [rightHand()]),
    );
    const unreliable = run(
      pipeline,
      repeat(40, () => [rightHand({ centre: { x: 0.3, y: 0.02 } })]),
      10 * FRAME_MS,
    );
    expect(last(unreliable).right.status).toBe('lost');
  });

  it('keeps the hands apart when the tracker gives both the same label', () => {
    const frame = last(
      run(
        new GesturePipeline(),
        repeat(10, () => [
          leftHand({ closure: 1, label: 'Right' }),
          rightHand({ closure: 0, label: 'Right' }),
        ]),
      ),
    );
    // Un-mirrored image: the hand nearer the image's left edge is the performer's right.
    expect(frame.right.openness).toBe(1);
    expect(frame.left.openness).toBe(0);
  });

  it('sorts same-label hands by position even when one of them arrived first', () => {
    const pipeline = new GesturePipeline();
    // The left fist is alone and mislabelled 'Right'; then the open right hand joins it.
    run(
      pipeline,
      repeat(30, () => [leftHand({ closure: 1, label: 'Right' })]),
    );
    const frame = last(
      run(
        pipeline,
        repeat(60, () => [leftHand({ closure: 1, label: 'Right' }), rightHand({ closure: 0 })]),
        30 * FRAME_MS,
      ),
    );
    expect(frame.right.status).toBe('tracking');
    expect(frame.left.status).toBe('tracking');
    expect(frame.right.openness).toBe(1);
    expect(frame.left.openness).toBe(0);
  });

  it('does not take a duplicate detection inside one hand for the other hand', () => {
    const real = (): RawHand => rightHand({ closure: 0.5, palmScale: 0.24 });
    const duplicate = (): RawHand =>
      rightHand({ closure: 0, palmScale: 0.14, centre: { x: 0.29, y: 0.48 } });
    const frames = run(
      new GesturePipeline(),
      repeat(30, () => [duplicate(), real()]),
    );
    for (const frame of frames) expect(frame.left.status).toBe('lost');
    expect(last(frames).right.openness).toBeCloseTo(measureOpenness(real()), 6);
  });

  it('forgets everything on reset but keeps the calibration', () => {
    const pipeline = new GesturePipeline({ neutralHandScale: 0.3 });
    run(
      pipeline,
      repeat(10, () => [rightHand({ closure: 0, palmScale: 0.3 })]),
    );
    pipeline.reset();
    // Not even the last result survives: an unusable frame has nothing to repeat.
    const repeated = pipeline.update(syntheticFrame(Number.NaN, []));
    expect(repeated.timestampMs).toBe(0);
    expect(repeated.right.status).toBe('lost');
    expect(repeated.right.openness).toBe(0);
    const empty = pipeline.update(syntheticFrame(1000, []));
    expect(empty.right.status).toBe('lost');
    expect(empty.right.openness).toBe(0);
    expect(empty.right.scale).toBe(0);
    const again = last(
      run(
        pipeline,
        repeat(3, () => [rightHand({ palmScale: 0.3 })]),
        1100,
      ),
    );
    expect(again.right.proximity).toBeCloseTo(0.5, 6);
  });
});

describe('GesturePipeline — a hand comes into view', () => {
  it('reports a new hand from its second confident frame on', () => {
    const frames = run(
      new GesturePipeline(),
      repeat(3, () => [rightHand()]),
    );
    expect(frames.map((frame) => frame.right.status)).toEqual(['lost', 'tracking', 'tracking']);
    expect(frames[0]?.right.landmarks).toBeNull();
    expect(frames[1]?.right.landmarks).toHaveLength(21);
  });

  it('never lets a mislabelled first frame reach the other hand', () => {
    // Whether the wrong label comes with a confident score or one below the tracking gate.
    for (const firstScore of [0.9, 0.6]) {
      const frames = run(
        new GesturePipeline(),
        repeat(60, (index) => [
          rightHand({ closure: 0, ...(index === 0 ? { label: 'Left', score: firstScore } : {}) }),
        ]),
      );
      for (const frame of frames) {
        expect(frame.left.status, `first score ${firstScore}`).toBe('lost');
        expect(frame.left.openness).toBe(0);
        expect(frame.left.landmarks).toBeNull();
      }
      const trackedFrom = frames.findIndex((frame) => frame.right.status === 'tracking');
      expect(trackedFrom).toBeGreaterThanOrEqual(2);
      expect(trackedFrom).toBeLessThanOrEqual(3);
      expect(last(frames).right.openness).toBe(1);
    }
  });

  it('does not disturb the hand already in view when a second one arrives mislabelled', () => {
    const pipeline = new GesturePipeline();
    // Arms crossed: the right hand (open) is on the image's right.
    const established = (): RawHand => rightHand({ closure: 0, centre: { x: 0.72, y: 0.5 } });
    run(
      pipeline,
      repeat(30, () => [established()]),
    );
    const frames = run(
      pipeline,
      repeat(30, (index) => [
        established(),
        leftHand({
          closure: 1,
          centre: { x: 0.28, y: 0.5 },
          ...(index === 0 ? { label: 'Right' as const } : {}),
        }),
      ]),
      30 * FRAME_MS,
    );
    for (const frame of frames) {
      expect(frame.right.status).toBe('tracking');
      expect(frame.right.openness).toBe(1);
      // The left channel only ever sees the fist, never the open right hand.
      if (frame.left.status === 'tracking') expect(frame.left.openness).toBe(0);
    }
    expect(last(frames).left.status).toBe('tracking');
  });
});

describe('GesturePipeline — unusable input', () => {
  it('holds over a detection whose palm has collapsed to a point, then carries on', () => {
    const pipeline = new GesturePipeline();
    const hand = (): RawHand => rightHand({ palmScale: 0.25 });
    const before = last(
      run(
        pipeline,
        repeat(15, () => [hand()]),
      ),
    );
    expect(before.right.proximity).toBeCloseTo(proximityFromScale(0.25), 6);

    const [degenerate] = run(pipeline, [[withCollapsedPalm(hand())]], 15 * FRAME_MS);
    expect(degenerate?.right.status).toBe('holding');
    expect(degenerate?.right.confidence).toBe(0);
    expect(degenerate?.right.proximity).toBe(before.right.proximity);
    expect(degenerate?.right.scale).toBe(before.right.scale);

    // One bad frame must not leave anything behind in the smoothing.
    const after = run(
      pipeline,
      repeat(10, () => [hand()]),
      16 * FRAME_MS,
    );
    for (const frame of after) {
      expect(frame.right.status).toBe('tracking');
      expect(frame.right.proximity).toBeCloseTo(proximityFromScale(0.25), 6);
    }
  });

  it('treats frames without a usable aspect ratio as empty, then carries on', () => {
    for (const badAspect of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1.5]) {
      const pipeline = new GesturePipeline();
      const hand = (): RawHand => rightHand({ closure: 0.55, palmScale: 0.25 });
      const before = last(
        run(
          pipeline,
          repeat(15, () => [hand()]),
        ),
      );
      for (let index = 0; index < 5; index += 1) {
        const frame = pipeline.update(syntheticFrame((15 + index) * FRAME_MS, [hand()], badAspect));
        expect(frame.right.status, `aspect ${badAspect}`).toBe('holding');
        expect(frame.right.proximity).toBe(before.right.proximity);
        expect(frame.right.openness).toBe(before.right.openness);
        expectFiniteState(frame.right);
        expectFiniteState(frame.left);
      }
      const after = last(
        run(
          pipeline,
          repeat(10, () => [hand()]),
          20 * FRAME_MS,
        ),
      );
      expect(after.right.status).toBe('tracking');
      expect(after.right.proximity).toBeCloseTo(proximityFromScale(0.25), 6);
      expect(after.right.openness).toBeCloseTo(before.right.openness, 6);
    }
  });

  it('ignores a frame that has no usable timestamp', () => {
    const pipeline = new GesturePipeline();
    // Before any usable frame there is nothing to repeat: both hands are simply lost.
    const first = pipeline.update(syntheticFrame(Number.NaN, [rightHand()]));
    expect(first.timestampMs).toBe(0);
    expect(first.right.status).toBe('lost');
    expect(first.left.status).toBe('lost');

    const before = last(
      run(
        pipeline,
        repeat(10, () => [rightHand()]),
      ),
    );
    for (const badTime of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pipeline.update(syntheticFrame(badTime, []))).toBe(before);
    }
    // The hand then vanishes for real: it is still held for the full hold time, then lost.
    const gone = run(
      pipeline,
      repeat(40, () => []),
      10 * FRAME_MS,
    );
    expect(gone[0]?.right.status).toBe('holding');
    const lostAt = gone.find((frame) => frame.right.status === 'lost');
    expect((lostAt?.timestampMs ?? 0) - before.timestampMs).toBeGreaterThanOrEqual(
      HOLD_DURATION_MS,
    );
    expect((lostAt?.timestampMs ?? 0) - before.timestampMs).toBeLessThan(
      HOLD_DURATION_MS + 2 * FRAME_MS,
    );
  });

  it('gives no confidence, and no say on handedness, to a score that is not a number', () => {
    const pipeline = new GesturePipeline();
    const frames = run(
      pipeline,
      repeat(40, (index) => [
        rightHand({ ...(index === 10 ? { label: 'Left' as const, score: Number.NaN } : {}) }),
      ]),
    );
    expect(frames[10]?.right.status).toBe('holding');
    expect(frames[10]?.right.confidence).toBe(0);
    for (const frame of frames) {
      expect(frame.left.status).toBe('lost');
      expectFiniteState(frame.left);
      expectFiniteState(frame.right);
    }
    for (const frame of frames.slice(11)) expect(frame.right.status).toBe('tracking');
  });

  it('reports only finite numbers whatever it is fed, and recovers at once', () => {
    const pipeline = new GesturePipeline({ neutralHandScale: Number.NaN });
    const garbage = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1, 1e300];
    // A small deterministic generator, so that a failure can be reproduced.
    let seed = 12345;
    const pick = <T>(options: readonly T[]): T => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      const option = options[seed % options.length];
      if (option === undefined) throw new Error('nothing to pick from');
      return option;
    };
    const corrupt = (hand: RawHand): RawHand => {
      const index = pick([0, 5, 9, 12, 17, 20]);
      const broken = { x: pick(garbage), y: pick(garbage), z: pick(garbage) };
      const replaceAt = <T>(items: T[], item: T): T[] =>
        items.map((existing, position) => (position === index ? item : existing));
      switch (pick(['score', 'image', 'world', 'palm', 'none'] as const)) {
        case 'score':
          return { ...hand, score: pick(garbage) };
        case 'image':
          return { ...hand, landmarks: replaceAt(hand.landmarks, broken) };
        case 'world':
          return { ...hand, worldLandmarks: replaceAt(hand.worldLandmarks, broken) };
        case 'palm':
          return withCollapsedPalm(hand);
        case 'none':
          return hand;
      }
    };

    for (let index = 0; index < 600; index += 1) {
      const timestampMs = pick([1, 1, 1, 0] as const) ? index * FRAME_MS : pick(garbage);
      const imageAspect = pick([1, 1, 1, 0] as const) ? SYNTHETIC_IMAGE_ASPECT : pick(garbage);
      const hands = [corrupt(rightHand({ closure: 0.5 })), corrupt(leftHand({ closure: 0.5 }))];
      const frame = pipeline.update({ timestampMs, imageAspect, hands });
      expect(Number.isFinite(frame.timestampMs)).toBe(true);
      expectFiniteState(frame.left);
      expectFiniteState(frame.right);
    }

    const recovered = last(
      run(
        pipeline,
        repeat(10, () => [rightHand({ closure: 0 }), leftHand({ closure: 1 })]),
        700 * FRAME_MS,
      ),
    );
    expect(recovered.right.status).toBe('tracking');
    expect(recovered.right.openness).toBe(1);
    expect(recovered.right.proximity).toBeCloseTo(0.5, 6);
    expect(recovered.left.status).toBe('tracking');
    expect(recovered.left.openness).toBe(0);
  });
});
