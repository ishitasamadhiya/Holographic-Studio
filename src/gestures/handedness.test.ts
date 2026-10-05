import { describe, expect, it } from 'vitest';
import type { HandSide } from '@shared/controls';
import { HandednessResolver, sideFromLabel } from './handedness';
import {
  SYNTHETIC_IMAGE_ASPECT,
  syntheticFrame,
  syntheticHand,
  type SyntheticHandOptions,
} from './testing/syntheticHand';
import type { RawHand } from './types';

const FRAME_MS = 1000 / 30;

/** Runs frames through a resolver and reports, per frame, the side given to each hand in order. */
function sidesOver(
  resolver: HandednessResolver,
  frames: RawHand[][],
  startMs = 0,
): Array<Array<HandSide | undefined>> {
  return frames.map((hands, index) => {
    const assignments = resolver.assign(syntheticFrame(startMs + index * FRAME_MS, hands));
    return hands.map((hand) => assignments.find((assignment) => assignment.hand === hand)?.side);
  });
}

function repeat(count: number, make: (index: number) => RawHand[]): RawHand[][] {
  return Array.from({ length: count }, (_, index) => make(index));
}

/**
 * A hand gets its side on its second confident frame, so the first frame of a run that starts
 * with new hands reports nothing; these helpers look at what follows.
 */
function onceSettled<T>(frames: T[]): T[] {
  return frames.slice(1);
}

/** The sides given to `hands` once they have been in view, unchanged, for a few frames. */
function settledSides(hands: RawHand[], resolver = new HandednessResolver()): unknown {
  return sidesOver(
    resolver,
    repeat(3, () => hands),
  )[2];
}

const rightHandAt = (x: number, options: SyntheticHandOptions = {}): RawHand =>
  syntheticHand({ side: 'right', centre: { x, y: 0.5 }, ...options });
const leftHandAt = (x: number, options: SyntheticHandOptions = {}): RawHand =>
  syntheticHand({ side: 'left', centre: { x, y: 0.5 }, ...options });

describe('sideFromLabel', () => {
  it("takes the tracker's label as the performer's own hand (un-mirrored frames, no swap)", () => {
    expect(sideFromLabel('Right')).toBe('right');
    expect(sideFromLabel('Left')).toBe('left');
  });
});

describe('HandednessResolver', () => {
  it('classifies a single hand by its label, wherever it is in the image', () => {
    for (const x of [0.15, 0.5, 0.85]) {
      expect(settledSides([rightHandAt(x)])).toEqual(['right']);
      expect(settledSides([leftHandAt(x)])).toEqual(['left']);
    }
  });

  it('gives a new hand its side on the second confident frame, not the first', () => {
    const sides = sidesOver(
      new HandednessResolver(),
      repeat(3, () => [leftHandAt(0.5)]),
    );
    expect(sides).toEqual([[undefined], ['left'], ['left']]);
  });

  it('never puts a hand on the wrong side because its first frame was mislabelled', () => {
    // Labels are least reliable as a hand comes into view. The first frame of this right hand
    // says 'Left', confidently or not; every later frame is correct.
    for (const firstScore of [0.99, 0.9, 0.75, 0.6]) {
      const frames = repeat(30, (index) => [
        rightHandAt(0.5, index === 0 ? { label: 'Left', score: firstScore } : {}),
      ]);
      const sides = sidesOver(new HandednessResolver(), frames).map((frame) => frame[0]);
      expect(sides, `first score ${firstScore}`).not.toContain('left');
      const decidedAt = sides.indexOf('right');
      expect(decidedAt, `first score ${firstScore}`).toBeGreaterThanOrEqual(2);
      expect(decidedAt, `first score ${firstScore}`).toBeLessThanOrEqual(4);
      expect(sides.slice(decidedAt).every((side) => side === 'right')).toBe(true);
    }
  });

  it('takes no vote from a detection that is too unreliable to track', () => {
    // A right hand creeps in from the top edge, half outside the picture and mislabelled all
    // the while. Only once it is properly in view do its labels count.
    const halfOutside = { centre: { x: 0.5, y: 0.02 }, label: 'Left' as const };
    const frames = [
      ...repeat(20, () => [syntheticHand({ side: 'right', ...halfOutside })]),
      ...repeat(10, () => [syntheticHand({ side: 'right', centre: { x: 0.5, y: 0.3 } })]),
    ];
    const sides = sidesOver(new HandednessResolver(), frames).map((frame) => frame[0]);
    expect(sides).not.toContain('left');
    expect(sides.indexOf('right')).toBe(21);
  });

  it('gives an unsure label on a hand in full view a smaller say than a sure one', () => {
    // An established right hand is relabelled 'Left' on every frame from frame 60 on.
    const framesToFlip = (score: number): number => {
      const frames = [
        ...repeat(60, () => [rightHandAt(0.5)]),
        ...repeat(60, () => [rightHandAt(0.5, { label: 'Left', score })]),
      ];
      const sides = sidesOver(new HandednessResolver(), frames).map((frame) => frame[0]);
      return sides.indexOf('left') - 60;
    };
    const sure = framesToFlip(0.95);
    const unsure = framesToFlip(0.65);
    expect(sure).toBeGreaterThan(0);
    expect(sure).toBeLessThanOrEqual(14);
    // Weight 2·score − 1: 0.3 against 0.9, so about three times as many frames.
    expect(unsure).toBeGreaterThan(2.5 * sure);
    expect(unsure).toBeLessThan(60);
  });

  it('keeps an established hand its side while it is mislabelled half out of the picture', () => {
    const frames = [
      ...repeat(30, () => [syntheticHand({ side: 'right', centre: { x: 0.5, y: 0.3 } })]),
      ...repeat(30, () => [
        syntheticHand({ side: 'right', centre: { x: 0.5, y: 0.02 }, label: 'Left' }),
      ]),
      ...repeat(5, () => [syntheticHand({ side: 'right', centre: { x: 0.5, y: 0.3 } })]),
    ];
    for (const frame of onceSettled(sidesOver(new HandednessResolver(), frames))) {
      expect(frame).toEqual(['right']);
    }
  });

  it('classifies two hands regardless of the order the tracker lists them in', () => {
    const right = rightHandAt(0.3);
    const left = leftHandAt(0.7);
    expect(settledSides([right, left])).toEqual(['right', 'left']);
    expect(settledSides([left, right])).toEqual(['left', 'right']);
  });

  it('trusts the labels over position when the arms are crossed', () => {
    const right = rightHandAt(0.75);
    const left = leftHandAt(0.25);
    expect(settledSides([right, left])).toEqual(['right', 'left']);
  });

  it('separates two hands that carry the same label by image position', () => {
    // Un-mirrored image: the performer's right hand is the one nearer the image's left edge.
    const nearImageLeft = rightHandAt(0.3);
    const nearImageRight = leftHandAt(0.7, { label: 'Right' });
    expect(settledSides([nearImageRight, nearImageLeft])).toEqual(['left', 'right']);

    const bothLeft = [rightHandAt(0.3, { label: 'Left' }), leftHandAt(0.7)];
    expect(settledSides(bothLeft)).toEqual(['right', 'left']);
  });

  it('keeps the two hands apart for as long as the tracker keeps mislabelling one of them', () => {
    const sides = sidesOver(
      new HandednessResolver(),
      repeat(90, () => [rightHandAt(0.3), leftHandAt(0.7, { label: 'Right' })]),
    );
    for (const frame of onceSettled(sides)) expect(frame).toEqual(['right', 'left']);
  });

  it('does not let a new hand unseat one that already has its side', () => {
    // Arms crossed: the established right hand is on the image's right. The left hand then
    // appears on the image's left, and its first frame is mislabelled 'Right'. Sorting the two
    // by position at that moment would swap the hand that was never in doubt.
    const established = (): RawHand => rightHandAt(0.75);
    const frames = [
      ...repeat(30, () => [established()]),
      ...repeat(30, (index) => [
        established(),
        leftHandAt(0.25, index === 0 ? { label: 'Right' } : {}),
      ]),
    ];
    const sides = onceSettled(sidesOver(new HandednessResolver(), frames));
    for (const frame of sides) expect(frame[0]).toBe('right');
    const newcomer = sides.slice(29).map((frame) => frame[1]);
    expect(newcomer).not.toContain('right');
    expect(newcomer.indexOf('left')).toBeLessThanOrEqual(4);
  });

  it('sorts a same-label pair by position even when one hand arrived first', () => {
    // The left hand (image right) is alone and mislabelled 'Right', so it is taken for the
    // right hand. Then the real right hand appears nearer the image's left edge, also 'Right'.
    const frames = [
      ...repeat(30, () => [leftHandAt(0.7, { label: 'Right', closure: 1 })]),
      ...repeat(300, () => [leftHandAt(0.7, { label: 'Right', closure: 1 }), rightHandAt(0.3)]),
    ];
    const sides = sidesOver(new HandednessResolver(), frames);
    for (const frame of sides.slice(1, 30)) expect(frame).toEqual(['right']);

    const together = sides.slice(30);
    const sortedAt = together.findIndex((frame) => frame[1] !== undefined);
    // The newcomer waits out its grace period rather than briefly taking the other side…
    expect(sortedAt * FRAME_MS).toBeGreaterThanOrEqual(300);
    expect(sortedAt * FRAME_MS).toBeLessThan(400);
    for (const frame of together.slice(0, sortedAt)) expect(frame).toEqual(['right', undefined]);
    // …and from then on position decides, for as long as both stay in view.
    for (const frame of together.slice(sortedAt)) expect(frame).toEqual(['left', 'right']);
  });

  it('gives a same-label pair the same sides however the hands came and went', () => {
    const resolver = new HandednessResolver();
    const left = (): RawHand => leftHandAt(0.7, { label: 'Right' });
    const right = (): RawHand => rightHandAt(0.3);
    const before = sidesOver(
      resolver,
      repeat(30, () => [left(), right()]),
    );
    expect(before[29]).toEqual(['left', 'right']);
    // The right hand leaves for 1.5 s, long enough to be forgotten; alone, the left hand then
    // goes by its (wrong) label. When the right hand returns, position sorts them out again.
    sidesOver(
      resolver,
      repeat(45, () => [left()]),
      30 * FRAME_MS,
    );
    const after = sidesOver(
      resolver,
      repeat(300, () => [left(), right()]),
      75 * FRAME_MS,
    );
    const sortedAt = after.findIndex((frame) => frame[1] !== undefined);
    expect(sortedAt * FRAME_MS).toBeLessThan(400);
    for (const frame of after.slice(sortedAt)) expect(frame).toEqual(['left', 'right']);
  });

  it('places a same-label newcomer at once when position leaves the established hand be', () => {
    const frames = [
      ...repeat(30, () => [rightHandAt(0.3)]),
      ...repeat(30, () => [rightHandAt(0.3), leftHandAt(0.7, { label: 'Right' })]),
    ];
    const newcomer = sidesOver(new HandednessResolver(), frames)
      .slice(30)
      .map((frame) => frame[1]);
    expect(newcomer).toEqual([undefined, ...new Array<string>(29).fill('left')]);
  });

  it('ignores a second detection inside a larger hand', () => {
    // The tracker sometimes reports a small extra "hand" within a real one.
    const resolver = new HandednessResolver();
    const real = (): RawHand => rightHandAt(0.5, { palmScale: 0.24 });
    const duplicate = (): RawHand =>
      syntheticHand({ side: 'right', centre: { x: 0.49, y: 0.48 }, palmScale: 0.14 });
    const sides = sidesOver(
      resolver,
      repeat(30, (index) => (index % 2 === 0 ? [duplicate(), real()] : [real(), duplicate()])),
    );
    for (const frame of onceSettled(sides)) {
      expect(frame.filter((side) => side !== undefined)).toEqual(['right']);
    }
    // The larger detection is the one kept.
    expect(sides[29]).toEqual(['right', undefined]);
  });

  it('still takes two hands close together as two hands', () => {
    // Palms side by side, about one palm length apart.
    const right = rightHandAt(0.45, { palmScale: 0.2 });
    const left = leftHandAt(0.45 + 0.2 / SYNTHETIC_IMAGE_ASPECT, { palmScale: 0.2 });
    expect(settledSides([right, left])).toEqual(['right', 'left']);
  });

  it('needs no agreeing labels from a hand that appears beside one that has its side', () => {
    // The newcomer's labels contradict each other frame after frame. Alone it would get no
    // side at all; next to an established right hand it can only be the left.
    const frames = [
      ...repeat(30, () => [rightHandAt(0.3)]),
      ...repeat(30, (index) => [
        rightHandAt(0.3),
        leftHandAt(0.7, index % 2 === 0 ? { label: 'Right' } : {}),
      ]),
    ];
    const sides = onceSettled(sidesOver(new HandednessResolver(), frames));
    for (const frame of sides) expect(frame[0]).toBe('right');
    const newcomer = sides.slice(29).map((frame) => frame[1]);
    expect(newcomer).toEqual([undefined, ...new Array<string>(29).fill('left')]);
  });

  it('lets the one hand with agreeing labels settle a pair that appears together', () => {
    // Arms crossed, so position would get it wrong. The right hand's labels agree; the left
    // hand's contradict each other, which leaves it the side the right hand did not take.
    const unsureLeft = (index: number): RawHand =>
      leftHandAt(0.25, index % 2 === 0 ? { label: 'Right' } : {});
    const leftListedFirst = sidesOver(
      new HandednessResolver(),
      repeat(10, (index) => [unsureLeft(index), rightHandAt(0.75)]),
    );
    expect(leftListedFirst[0]).toEqual([undefined, undefined]);
    for (const frame of onceSettled(leftListedFirst)) expect(frame).toEqual(['left', 'right']);

    const rightListedFirst = sidesOver(
      new HandednessResolver(),
      repeat(10, (index) => [rightHandAt(0.75), unsureLeft(index)]),
    );
    for (const frame of onceSettled(rightListedFirst)) expect(frame).toEqual(['right', 'left']);
  });

  it('tells two new hands apart by position when neither has labels that agree', () => {
    const frames = repeat(20, (index) => [
      leftHandAt(0.7, index % 2 === 0 ? { label: 'Right' } : {}),
      rightHandAt(0.3, index % 2 === 0 ? { label: 'Left' } : {}),
    ]);
    const sides = sidesOver(new HandednessResolver(), frames);
    expect(sides[0]).toEqual([undefined, undefined]);
    for (const frame of onceSettled(sides)) expect(frame).toEqual(['left', 'right']);
  });

  it('does not let a noisy frame or two flip an established hand', () => {
    const resolver = new HandednessResolver();
    const frames = repeat(60, (index) => {
      const mislabelled = index === 20 || index === 21 || index === 40;
      return [rightHandAt(0.5, mislabelled ? { label: 'Left', score: 0.9 } : {})];
    });
    for (const frame of onceSettled(sidesOver(resolver, frames))) expect(frame).toEqual(['right']);
  });

  it('survives heavy label noise as long as the true label is the more common one', () => {
    const resolver = new HandednessResolver();
    // Every third frame is wrong.
    const frames = repeat(120, (index) => [
      rightHandAt(0.5, index % 3 === 2 ? { label: 'Left' } : {}),
    ]);
    for (const frame of onceSettled(sidesOver(resolver, frames))) expect(frame).toEqual(['right']);
  });

  it('settles on the surer label, without flapping, when the label of a new hand alternates', () => {
    const resolver = new HandednessResolver();
    // Every other frame is wrong, though (as with the real tracker) a little less sure of itself.
    const frames = repeat(40, (index) => [
      leftHandAt(0.5, index % 2 === 1 ? { label: 'Right', score: 0.8 } : {}),
    ]);
    const sides = sidesOver(resolver, frames).map((frame) => frame[0]);
    expect(sides).not.toContain('right');
    const decidedAt = sides.indexOf('left');
    expect(decidedAt).toBeLessThanOrEqual(6);
    expect(sides.slice(decidedAt).every((side) => side === 'left')).toBe(true);
  });

  it('gives no side to a new hand whose labels contradict each other with equal certainty', () => {
    const resolver = new HandednessResolver();
    const frames = repeat(40, (index) => [
      leftHandAt(0.5, index % 2 === 1 ? { label: 'Right' } : {}),
    ]);
    for (const frame of sidesOver(resolver, frames)) expect(frame).toEqual([undefined]);
  });

  it('corrects a hand whose first frames were all mislabelled', () => {
    const resolver = new HandednessResolver();
    // Two confident frames that agree are indistinguishable from the truth, so this hand does
    // start out on the wrong side.
    const frames = repeat(30, (index) => [leftHandAt(0.5, index < 2 ? { label: 'Right' } : {})]);
    const sides = sidesOver(resolver, frames);
    expect(sides[1]).toEqual(['right']);
    expect(sides[29]).toEqual(['left']);
    // …and once corrected it stays corrected.
    const firstCorrect = sides.findIndex((frame) => frame[0] === 'left');
    expect(firstCorrect).toBeLessThan(10);
    for (const frame of sides.slice(firstCorrect)) expect(frame).toEqual(['left']);
  });

  it('follows sustained relabelling of a lone hand after about a third of a second', () => {
    const resolver = new HandednessResolver();
    const frames = [
      ...repeat(60, () => [rightHandAt(0.5)]),
      ...repeat(30, () => [rightHandAt(0.5, { label: 'Left' })]),
    ];
    const sides = sidesOver(resolver, frames);
    const flippedAt = sides.findIndex((frame) => frame[0] === 'left');
    expect(flippedAt).toBeGreaterThanOrEqual(60 + 8);
    expect(flippedAt).toBeLessThanOrEqual(60 + 14);
  });

  it('keeps each hand its side while the hands cross over', () => {
    const resolver = new HandednessResolver();
    // The right hand sweeps from image-left to image-right above the left hand, which sweeps back.
    const frames = repeat(61, (index) => {
      const progress = index / 60;
      return [
        syntheticHand({ side: 'right', centre: { x: 0.2 + 0.6 * progress, y: 0.35 } }),
        syntheticHand({ side: 'left', centre: { x: 0.8 - 0.6 * progress, y: 0.65 } }),
      ];
    });
    for (const frame of onceSettled(sidesOver(resolver, frames))) {
      expect(frame).toEqual(['right', 'left']);
    }
  });

  it('keeps each hand its side while crossing even when the labels turn unreliable', () => {
    const resolver = new HandednessResolver();
    const frames = repeat(91, (index) => {
      const progress = Math.min(1, index / 60);
      // Mid-crossing the tracker calls both hands 'Right' for ten frames.
      const confused = index >= 25 && index < 35;
      return [
        syntheticHand({ side: 'right', centre: { x: 0.2 + 0.6 * progress, y: 0.35 } }),
        syntheticHand({
          side: 'left',
          centre: { x: 0.8 - 0.6 * progress, y: 0.65 },
          ...(confused ? { label: 'Right' as const } : {}),
        }),
      ];
    });
    for (const frame of onceSettled(sidesOver(resolver, frames))) {
      expect(frame).toEqual(['right', 'left']);
    }
  });

  it('does not swap two same-label hands when they cross', () => {
    const resolver = new HandednessResolver();
    const frames = repeat(61, (index) => {
      const progress = index / 60;
      return [
        syntheticHand({ side: 'right', centre: { x: 0.2 + 0.6 * progress, y: 0.35 } }),
        syntheticHand({
          side: 'left',
          label: 'Right',
          centre: { x: 0.8 - 0.6 * progress, y: 0.65 },
        }),
      ];
    });
    for (const frame of onceSettled(sidesOver(resolver, frames))) {
      expect(frame).toEqual(['right', 'left']);
    }
  });

  it('follows both hands when they move the same way together', () => {
    const resolver = new HandednessResolver();
    // Arms crossed, so position cannot rescue a wrong match. After the jump each detection is
    // nearer the OTHER hand's old place than its own.
    const frames = [
      ...repeat(15, () => [rightHandAt(0.45), leftHandAt(0.3)]),
      [rightHandAt(0.57), leftHandAt(0.42)],
    ];
    for (const frame of onceSettled(sidesOver(resolver, frames))) {
      expect(frame).toEqual(['right', 'left']);
    }
  });

  it('lets a lone hand keep its side while its partner flickers out of view', () => {
    const resolver = new HandednessResolver();
    const frames = repeat(60, (index) => {
      const hands = [leftHandAt(0.7, { label: 'Right' })];
      // The correctly labelled right hand drops out on every fourth frame.
      if (index % 4 !== 3) hands.push(rightHandAt(0.3));
      return hands;
    });
    for (const frame of onceSettled(sidesOver(resolver, frames))) expect(frame[0]).toBe('left');
  });

  it('goes back to the label once the partner has really gone', () => {
    const resolver = new HandednessResolver();
    const frames = [
      ...repeat(20, () => [leftHandAt(0.7, { label: 'Right' }), rightHandAt(0.3)]),
      ...repeat(60, () => [leftHandAt(0.7, { label: 'Right' })]),
    ];
    const sides = sidesOver(resolver, frames);
    expect(sides[19]?.[0]).toBe('left');
    expect(sides[30]?.[0]).toBe('left');
    expect(sides[79]?.[0]).toBe('right');
  });

  it('classifies a newly arrived hand by its own label, not by a hand that just left', () => {
    const resolver = new HandednessResolver();
    const frames = [
      ...repeat(30, () => [leftHandAt(0.8)]),
      // The left hand leaves; within the same moment a right hand shows up across the image.
      ...repeat(5, () => [rightHandAt(0.2)]),
    ];
    const sides = sidesOver(resolver, frames);
    expect(sides[30]).toEqual([undefined]);
    expect(sides[31]).toEqual(['right']);
    expect(sides[34]).toEqual(['right']);
  });

  it('forgets a hand that has been gone for a while', () => {
    const resolver = new HandednessResolver();
    sidesOver(
      resolver,
      repeat(30, () => [rightHandAt(0.5)]),
    );
    // Two seconds later a hand at the same place is labelled 'Left': it is a new hand.
    const later = sidesOver(
      resolver,
      repeat(2, () => [leftHandAt(0.5)]),
      3000,
    );
    expect(later).toEqual([[undefined], ['left']]);
  });

  it('uses the two most certain detections when there are more than two', () => {
    const sure = rightHandAt(0.2, { score: 0.99 });
    const alsoSure = leftHandAt(0.8, { score: 0.98 });
    const doubtful = leftHandAt(0.5, { score: 0.6 });
    expect(settledSides([doubtful, sure, alsoSure])).toEqual([undefined, 'right', 'left']);
  });

  it('ignores detections with incomplete landmarks', () => {
    const complete = rightHandAt(0.4);
    const truncated = { ...leftHandAt(0.7), landmarks: [] };
    expect(settledSides([truncated, complete])).toEqual([undefined, 'right']);
  });

  it('is not thrown by a label score that is not a number', () => {
    // NaN in the vote tally would stay there and make every later comparison come out false.
    const resolver = new HandednessResolver();
    const frames = repeat(40, (index) => [
      rightHandAt(0.5, index === 0 || index === 10 ? { label: 'Left', score: Number.NaN } : {}),
    ]);
    const sides = sidesOver(resolver, frames).map((frame) => frame[0]);
    expect(sides).not.toContain('left');
    expect(sides.indexOf('right')).toBe(2);
    expect(sides.slice(2).every((side) => side === 'right')).toBe(true);
  });

  it('never gives both hands the same side', () => {
    const resolver = new HandednessResolver();
    const labels = ['Left', 'Right'] as const;
    let framesWithBothHands = 0;
    for (let index = 0; index < 200; index += 1) {
      const first = syntheticHand({
        centre: { x: 0.3 + 0.1 * Math.sin(index / 7), y: 0.4 },
        label: labels[(index * 7) % 2],
      });
      const second = syntheticHand({
        centre: { x: 0.7 + 0.1 * Math.cos(index / 5), y: 0.6 },
        label: labels[Math.floor(index / 3) % 2],
      });
      const sides = resolver
        .assign(syntheticFrame(index * FRAME_MS, [first, second]))
        .map((assignment) => assignment.side);
      expect(new Set(sides).size).toBe(sides.length);
      if (sides.length === 2) framesWithBothHands += 1;
    }
    expect(framesWithBothHands).toBeGreaterThan(150);
  });

  it('starts afresh after reset', () => {
    const resolver = new HandednessResolver();
    sidesOver(
      resolver,
      repeat(30, () => [rightHandAt(0.5)]),
    );
    resolver.reset();
    // Without the reset the established right hand would shrug off two 'Left' frames.
    const relabelled = repeat(2, () => [rightHandAt(0.5, { label: 'Left' })]);
    expect(sidesOver(resolver, relabelled, 1000)).toEqual([[undefined], ['left']]);
  });
});
