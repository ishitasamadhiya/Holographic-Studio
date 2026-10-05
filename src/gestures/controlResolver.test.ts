import { describe, expect, it } from 'vitest';
import { CONTROL_IDS, type ControlId, type GestureBinding } from '@shared/controls';
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings';
import {
  ControlResolver,
  MAX_CONTROL_SPEED_PER_SEC,
  MAX_CONTROL_STEP,
  RECOVERY_BLEND_MS,
  RETURN_TO_MANUAL_MS,
  type ControlResolverConfig,
  type ResolvedControls,
} from './controlResolver';
import { GesturePipeline } from './gesturePipeline';
import { HOLD_DURATION_MS } from './handChannel';
import { syntheticFrame, syntheticHand } from './testing/syntheticHand';
import type { GestureFrame, HandState, RawHand } from './types';

const FRAME_MS = 1000 / 30;
/** Largest change a gesture-driven control may make in one 30 fps frame. */
const MAX_STEP_PER_FRAME = (MAX_CONTROL_SPEED_PER_SEC * FRAME_MS) / 1000 + 1e-9;
/**
 * Steepest 30 fps step of a blend onto the hand, per unit of distance blended: the eased
 * curve peaks at 1.5× its average slope.
 */
const BLEND_STEP_PER_UNIT = (1.5 * FRAME_MS) / RECOVERY_BLEND_MS + 1e-9;

type ControlOverrides = Partial<Settings['controls']>;

function config(overrides: ControlOverrides = {}, gesturesAvailable = true): ControlResolverConfig {
  return {
    gesturesAvailable,
    controls: {
      ...DEFAULT_SETTINGS.controls,
      autotune: { source: 'gesture', manual: 0.5 },
      echo: { source: 'gesture', manual: 0.2 },
      volume: { source: 'gesture', manual: 0.5 },
      ...overrides,
    },
  };
}

function hand(side: 'left' | 'right', state: Partial<HandState> = {}): HandState {
  return {
    side,
    status: 'tracking',
    openness: 0,
    proximity: 0.5,
    scale: 0.18,
    confidence: 1,
    landmarks: null,
    ...state,
  };
}

function gestureFrame(
  timestampMs: number,
  right: Partial<HandState> = {},
  left: Partial<HandState> = {},
): GestureFrame {
  return { timestampMs, left: hand('left', left), right: hand('right', right) };
}

interface Step {
  timeMs: number;
  result: ResolvedControls;
}

/** Calls the resolver once per 30 fps frame for `durationMs`, building each frame with `frameAt`. */
function simulate(
  resolver: ControlResolver,
  startMs: number,
  durationMs: number,
  frameAt: (timeMs: number) => GestureFrame | null,
  settings: ControlResolverConfig | ((timeMs: number) => ControlResolverConfig) = config(),
): Step[] {
  const steps: Step[] = [];
  const count = Math.round(durationMs / FRAME_MS);
  for (let index = 0; index < count; index += 1) {
    const timeMs = startMs + index * FRAME_MS;
    const current = typeof settings === 'function' ? settings(timeMs) : settings;
    steps.push({ timeMs, result: resolver.resolve(frameAt(timeMs), current, timeMs) });
  }
  return steps;
}

function largestStep(steps: Step[], control: ControlId, from?: number): number {
  let previous = from ?? steps[0]?.result.values[control] ?? 0;
  let largest = 0;
  for (const step of steps) {
    largest = Math.max(largest, Math.abs(step.result.values[control] - previous));
    previous = step.result.values[control];
  }
  return largest;
}

function final(steps: Step[]): ResolvedControls {
  const step = steps[steps.length - 1];
  if (!step) throw new Error('no steps');
  return step.result;
}

/** A small deterministic random generator, so that a failing pattern can be reproduced. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function expectUsableValues(result: ResolvedControls): void {
  for (const control of CONTROL_IDS) {
    const value = result.values[control];
    expect(Number.isFinite(value), `${control} = ${value}`).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
}

describe('ControlResolver — manual control', () => {
  const liveHands = (timeMs: number): GestureFrame =>
    gestureFrame(timeMs, { openness: 0.9, proximity: 0.8 }, { openness: 0.7 });

  it('uses exactly the slider for a control whose source is manual', () => {
    const resolver = new ControlResolver();
    const settings = config({ autotune: { source: 'manual', manual: 0.33 } });
    const steps = simulate(resolver, 0, 600, liveHands, settings);
    for (const { result } of steps) {
      expect(result.values.autotune).toBe(0.33);
      expect(result.status.autotune).toBe('manual');
    }
    // The other controls are untouched by that choice.
    expect(final(steps).status.echo).toBe('gesture');
    expect(final(steps).values.echo).toBeCloseTo(0.7, 9);
  });

  it('uses exactly the sliders when hand control is switched off', () => {
    const resolver = new ControlResolver();
    const steps = simulate(resolver, 0, 300, liveHands, config({ handControlEnabled: false }));
    for (const { result } of steps) {
      expect(result.values).toEqual({ autotune: 0.5, echo: 0.2, volume: 0.5 });
      expect(result.status).toEqual({ autotune: 'manual', echo: 'manual', volume: 'manual' });
    }
  });

  it('uses exactly the sliders when gestures are not available', () => {
    const resolver = new ControlResolver();
    const steps = simulate(resolver, 0, 300, liveHands, config({}, false));
    for (const { result } of steps) {
      expect(result.values).toEqual({ autotune: 0.5, echo: 0.2, volume: 0.5 });
      expect(result.status).toEqual({ autotune: 'manual', echo: 'manual', volume: 'manual' });
    }
  });

  it('clamps an out-of-range slider value', () => {
    const resolver = new ControlResolver();
    const settings = config({
      autotune: { source: 'manual', manual: 1.4 },
      echo: { source: 'manual', manual: -0.2 },
    });
    const { values } = resolver.resolve(null, settings, 0);
    expect(values.autotune).toBe(1);
    expect(values.echo).toBe(0);
  });

  it('sits on the sliders when there is no gesture frame at all', () => {
    const resolver = new ControlResolver();
    const steps = simulate(resolver, 0, 300, () => null);
    for (const { result } of steps) {
      expect(result.values).toEqual({ autotune: 0.5, echo: 0.2, volume: 0.5 });
      expect(result.status).toEqual({ autotune: 'manual', echo: 'manual', volume: 'manual' });
    }
  });
});

describe('ControlResolver — following the hands', () => {
  it('maps right-hand openness to autotune, right-hand proximity to volume and left-hand openness to echo', () => {
    const resolver = new ControlResolver();
    const steps = simulate(resolver, 0, 500, (timeMs) =>
      gestureFrame(timeMs, { openness: 0.9, proximity: 0.3 }, { openness: 0.65, proximity: 0.99 }),
    );
    const { values, status } = final(steps);
    expect(values.autotune).toBeCloseTo(0.9, 9);
    expect(values.volume).toBeCloseTo(0.3, 9);
    expect(values.echo).toBeCloseTo(0.65, 9);
    expect(status).toEqual({ autotune: 'gesture', echo: 'gesture', volume: 'gesture' });
  });

  it('honours custom bindings, and leaves an unbound control on its slider', () => {
    const bindings: GestureBinding[] = [
      { control: 'echo', hand: 'left', feature: 'proximity' },
      { control: 'volume', hand: 'left', feature: 'openness' },
      // A second binding for an already-bound control is ignored.
      { control: 'echo', hand: 'right', feature: 'openness' },
    ];
    const resolver = new ControlResolver(bindings);
    const steps = simulate(resolver, 0, 500, (timeMs) =>
      gestureFrame(timeMs, { openness: 0.9 }, { openness: 0.1, proximity: 0.8 }),
    );
    const { values, status } = final(steps);
    expect(values.echo).toBeCloseTo(0.8, 9);
    expect(values.volume).toBeCloseTo(0.1, 9);
    expect(values.autotune).toBe(0.5);
    expect(status.autotune).toBe('manual');
  });

  it('blends from the slider onto the hand when it first appears, without a jump', () => {
    const resolver = new ControlResolver();
    const steps = simulate(resolver, 0, 600, (timeMs) => gestureFrame(timeMs, { openness: 1 }));
    expect(steps[0]?.result.values.autotune).toBe(0.5);
    expect(largestStep(steps, 'autotune')).toBeLessThanOrEqual(0.5 * BLEND_STEP_PER_UNIT);
    const arrived = steps.find((step) => step.result.values.autotune === 1);
    expect(arrived?.timeMs).toBeLessThanOrEqual(RECOVERY_BLEND_MS + FRAME_MS);
    for (const { result } of steps) expect(result.status.autotune).toBe('gesture');
  });

  it('follows the hand exactly once blended in', () => {
    const resolver = new ControlResolver();
    const wave = (timeMs: number): number => 0.5 + 0.4 * Math.sin(timeMs / 300);
    const steps = simulate(resolver, 0, 3000, (timeMs) =>
      gestureFrame(timeMs, { openness: wave(timeMs) }),
    );
    for (const step of steps.filter((candidate) => candidate.timeMs > RECOVERY_BLEND_MS + 50)) {
      expect(step.result.values.autotune).toBeCloseTo(wave(step.timeMs), 9);
    }
  });

  it('limits how fast a control can move even if the gesture value teleports', () => {
    const resolver = new ControlResolver();
    simulate(resolver, 0, 600, (timeMs) => gestureFrame(timeMs, { openness: 0 }));
    const steps = simulate(resolver, 600, 400, (timeMs) => gestureFrame(timeMs, { openness: 1 }));
    expect(largestStep(steps, 'autotune', 0)).toBeLessThanOrEqual(MAX_STEP_PER_FRAME);
    expect(largestStep(steps, 'autotune', 0)).toBeGreaterThan(0.2);
    expect(final(steps).values.autotune).toBe(1);
  });

  it('eases back in, rather than leaping, after the caller itself stalls', () => {
    const resolver = new ControlResolver();
    simulate(resolver, 0, 600, (timeMs) => gestureFrame(timeMs, { openness: 0 }));
    // Two seconds pass without a single resolve() call; by then the hand is wide open.
    const steps = simulate(resolver, 2600, 600, (timeMs) => gestureFrame(timeMs, { openness: 1 }));
    expect(steps[0]?.result.values.autotune).toBe(0);
    expect(largestStep(steps, 'autotune', 0)).toBeLessThanOrEqual(BLEND_STEP_PER_UNIT);
    expect(final(steps).values.autotune).toBe(1);
  });
});

describe('ControlResolver — a hand is lost', () => {
  /** Right hand: tracked until 1000 ms, then missing (holding, then lost) for good. */
  function rightHandVanishes(timeMs: number): GestureFrame {
    const missingForMs = timeMs - 1000;
    if (missingForMs < 0)
      return gestureFrame(timeMs, { openness: 0.9, proximity: 0.8 }, { openness: 0.7 });
    const status = missingForMs < HOLD_DURATION_MS ? 'holding' : 'lost';
    return gestureFrame(timeMs, { status, openness: 0.9, proximity: 0.8 }, { openness: 0.7 });
  }
  const lostAtMs = 1000 + HOLD_DURATION_MS;

  it('holds the value, then eases to the slider over about 1.5 s, then rests there as manual', () => {
    const resolver = new ControlResolver();
    const steps = simulate(resolver, 0, 4500, rightHandVanishes);

    for (const { timeMs, result } of steps) {
      const { autotune } = result.values;
      const status = result.status.autotune;
      if (timeMs > RECOVERY_BLEND_MS + 50 && timeMs < 1000) {
        expect(status).toBe('gesture');
        expect(autotune).toBeCloseTo(0.9, 9);
      } else if (timeMs >= 1000 && timeMs < lostAtMs) {
        expect(status).toBe('holding');
        expect(autotune).toBeCloseTo(0.9, 9);
      } else if (
        timeMs >= lostAtMs + FRAME_MS &&
        timeMs < lostAtMs + RETURN_TO_MANUAL_MS - FRAME_MS
      ) {
        expect(status).toBe('returning');
        expect(autotune).toBeLessThan(0.9);
        expect(autotune).toBeGreaterThan(0.5);
      } else if (timeMs >= lostAtMs + RETURN_TO_MANUAL_MS + FRAME_MS) {
        expect(status).toBe('manual');
        expect(autotune).toBe(0.5);
      }
    }
  });

  it('eases smoothly: monotonic, gentle at both ends, about half way at half time', () => {
    const resolver = new ControlResolver();
    const steps = simulate(resolver, 0, 4500, rightHandVanishes);
    const returning = steps.filter((step) => step.result.status.autotune === 'returning');
    expect(returning.length).toBeGreaterThan(40);

    let previous = 0.9;
    for (const step of returning) {
      expect(step.result.values.autotune).toBeLessThanOrEqual(previous);
      previous = step.result.values.autotune;
    }
    expect(largestStep(returning, 'autotune', 0.9)).toBeLessThan(0.02);

    const firstMove = 0.9 - (returning[1]?.result.values.autotune ?? 0);
    expect(firstMove).toBeLessThan(0.002);
    const halfWay = returning.find((step) => step.timeMs >= lostAtMs + RETURN_TO_MANUAL_MS / 2);
    expect(halfWay?.result.values.autotune).toBeCloseTo(0.7, 1);
  });

  it('returns only the controls of the lost hand', () => {
    const resolver = new ControlResolver();
    const steps = simulate(resolver, 0, 4500, rightHandVanishes);
    const { values, status } = final(steps);
    expect(status).toEqual({ autotune: 'manual', volume: 'manual', echo: 'gesture' });
    expect(values.autotune).toBe(0.5);
    expect(values.volume).toBe(0.5);
    expect(values.echo).toBeCloseTo(0.7, 9);
    for (const control of CONTROL_IDS) {
      expect(largestStep(steps, control)).toBeLessThan(0.12);
    }
  });

  it('follows the slider directly while resting on it', () => {
    const resolver = new ControlResolver();
    simulate(resolver, 0, 4500, rightHandVanishes);
    const moved = resolver.resolve(
      rightHandVanishes(4500),
      config({ autotune: { source: 'gesture', manual: 0.1 } }),
      4500,
    );
    expect(moved.values.autotune).toBe(0.1);
    expect(moved.status.autotune).toBe('manual');
  });

  it('heads for the slider as it is now if the slider moves during the return', () => {
    const resolver = new ControlResolver();
    const steps = simulate(resolver, 0, 4500, rightHandVanishes, (timeMs) =>
      config({ autotune: { source: 'gesture', manual: timeMs < lostAtMs + 700 ? 0.5 : 0.3 } }),
    );
    expect(final(steps).values.autotune).toBe(0.3);
    expect(final(steps).status.autotune).toBe('manual');
    expect(largestStep(steps, 'autotune')).toBeLessThan(0.12);
  });

  it('picks the ease up where it left off if the caller stalls part-way', () => {
    const resolver = new ControlResolver();
    const settings = config({ autotune: { source: 'gesture', manual: 0 } });
    const stallAtMs = lostAtMs + 300;
    const before = simulate(resolver, 0, stallAtMs, rightHandVanishes, settings);
    const valueBefore = final(before).values.autotune;
    expect(final(before).status.autotune).toBe('returning');
    expect(valueBefore).toBeGreaterThan(0.7);

    // No resolve() call for a full second: on the caller's clock the ease should be nearly done.
    const after = simulate(resolver, stallAtMs + 1000, 2500, rightHandVanishes, settings);
    expect(Math.abs((after[0]?.result.values.autotune ?? 0) - valueBefore)).toBeLessThan(0.1);
    expect(after[0]?.result.status.autotune).toBe('returning');
    expect(largestStep(after, 'autotune', valueBefore)).toBeLessThan(0.1);
    expect(final(after).values.autotune).toBe(0);
    expect(final(after).status.autotune).toBe('manual');
  });

  it('never outruns the speed ceiling, even if the slider leaps as the ease ends', () => {
    const resolver = new ControlResolver();
    const leapAtMs = lostAtMs + RETURN_TO_MANUAL_MS - FRAME_MS;
    const steps = simulate(resolver, 0, 4500, rightHandVanishes, (timeMs) =>
      config({ volume: { source: 'gesture', manual: timeMs < leapAtMs ? 0.1 : 1 } }),
    );
    expect(largestStep(steps, 'volume')).toBeLessThanOrEqual(MAX_STEP_PER_FRAME);
    expect(final(steps).values.volume).toBe(1);
    expect(final(steps).status.volume).toBe('manual');
  });

  it('returns both hands’ controls when both hands are lost', () => {
    const resolver = new ControlResolver();
    const steps = simulate(resolver, 0, 4500, (timeMs) => {
      const missingForMs = timeMs - 1000;
      const status =
        missingForMs < 0 ? 'tracking' : missingForMs < HOLD_DURATION_MS ? 'holding' : 'lost';
      return gestureFrame(timeMs, { status, openness: 1, proximity: 1 }, { status, openness: 1 });
    });
    const holding = steps.find((step) => step.timeMs >= 1400);
    expect(holding?.result.status).toEqual({
      autotune: 'holding',
      echo: 'holding',
      volume: 'holding',
    });
    expect(holding?.result.values).toEqual({ autotune: 1, echo: 1, volume: 1 });
    const returning = steps.find((step) => step.timeMs >= lostAtMs + 500);
    expect(returning?.result.status).toEqual({
      autotune: 'returning',
      echo: 'returning',
      volume: 'returning',
    });
    expect(final(steps).values).toEqual({ autotune: 0.5, echo: 0.2, volume: 0.5 });
    expect(final(steps).status).toEqual({ autotune: 'manual', echo: 'manual', volume: 'manual' });
  });
});

describe('ControlResolver — the hand comes back', () => {
  /** Tracked (open) until 1000 ms, gone until `backAtMs`, then tracked again as a fist. */
  function vanishesUntil(backAtMs: number): (timeMs: number) => GestureFrame {
    return (timeMs) => {
      if (timeMs < 1000) return gestureFrame(timeMs, { openness: 1 });
      if (timeMs >= backAtMs) return gestureFrame(timeMs, { openness: 0 });
      const status = timeMs - 1000 < HOLD_DURATION_MS ? 'holding' : 'lost';
      return gestureFrame(timeMs, { status, openness: 1 });
    };
  }

  it('blends back quickly and without a jump after resting on the slider', () => {
    const resolver = new ControlResolver();
    const backAtMs = 6000;
    const steps = simulate(resolver, 0, 7000, vanishesUntil(backAtMs));
    expect(largestStep(steps, 'autotune')).toBeLessThanOrEqual(0.5 * BLEND_STEP_PER_UNIT);

    const justBefore = steps.filter((step) => step.timeMs < backAtMs).pop();
    expect(justBefore?.result.values.autotune).toBe(0.5);
    const firstBack = steps.find((step) => step.timeMs >= backAtMs);
    expect(firstBack?.result.status.autotune).toBe('gesture');
    expect(firstBack?.result.values.autotune).toBe(0.5);
    const arrived = steps.find(
      (step) => step.timeMs >= backAtMs && step.result.values.autotune === 0,
    );
    expect(arrived).toBeDefined();
    expect((arrived?.timeMs ?? Infinity) - backAtMs).toBeLessThanOrEqual(
      RECOVERY_BLEND_MS + FRAME_MS,
    );
  });

  it('blends back without a jump when it returns in the middle of the ease to manual', () => {
    const resolver = new ControlResolver();
    const backAtMs = 1000 + HOLD_DURATION_MS + 700;
    const steps = simulate(resolver, 0, 4000, vanishesUntil(backAtMs));
    const justBefore = steps.filter((step) => step.timeMs < backAtMs).pop();
    expect(justBefore?.result.status.autotune).toBe('returning');
    const blendDistance = justBefore?.result.values.autotune ?? 1;
    expect(blendDistance).toBeGreaterThan(0.6);
    expect(largestStep(steps, 'autotune')).toBeLessThanOrEqual(blendDistance * BLEND_STEP_PER_UNIT);
    expect(final(steps).values.autotune).toBe(0);
    expect(final(steps).status.autotune).toBe('gesture');
  });

  it('blends without a jump when it returns during the hold in a different pose', () => {
    const resolver = new ControlResolver();
    const backAtMs = 1400;
    const steps = simulate(resolver, 0, 2500, vanishesUntil(backAtMs));
    expect(largestStep(steps, 'autotune')).toBeLessThanOrEqual(BLEND_STEP_PER_UNIT);
    const justBefore = steps.filter((step) => step.timeMs < backAtMs).pop();
    expect(justBefore?.result.status.autotune).toBe('holding');
    expect(justBefore?.result.values.autotune).toBe(1);
    expect(final(steps).values.autotune).toBe(0);
  });
});

describe('ControlResolver — switching between gesture and manual', () => {
  const openHand = (timeMs: number): GestureFrame => gestureFrame(timeMs, { openness: 1 });

  it('takes the slider value at once when a control is switched to manual', () => {
    const resolver = new ControlResolver();
    simulate(resolver, 0, 1000, openHand);
    const switched = resolver.resolve(
      openHand(1000),
      config({ autotune: { source: 'manual', manual: 0.25 } }),
      1000,
    );
    expect(switched.values.autotune).toBe(0.25);
    expect(switched.status.autotune).toBe('manual');
  });

  it('blends onto the hand, without a jump, when a control is switched to gesture', () => {
    const resolver = new ControlResolver();
    const steps = simulate(resolver, 0, 2000, openHand, (timeMs) =>
      config({ autotune: { source: timeMs < 1000 ? 'manual' : 'gesture', manual: 0.25 } }),
    );
    const beforeSwitch = steps.filter((step) => step.timeMs < 1000);
    for (const step of beforeSwitch) expect(step.result.values.autotune).toBe(0.25);
    expect(largestStep(steps, 'autotune')).toBeLessThanOrEqual(0.75 * BLEND_STEP_PER_UNIT);
    expect(final(steps).values.autotune).toBe(1);
    expect(final(steps).status.autotune).toBe('gesture');
  });

  it('blends back in after hand control is switched off and on again', () => {
    const resolver = new ControlResolver();
    const steps = simulate(resolver, 0, 3000, openHand, (timeMs) =>
      config({ handControlEnabled: timeMs < 1000 || timeMs >= 2000 }),
    );
    const whileOff = steps.filter((step) => step.timeMs >= 1000 && step.timeMs < 2000);
    for (const step of whileOff) expect(step.result.values.autotune).toBe(0.5);
    const afterOn = steps.filter((step) => step.timeMs >= 2000);
    expect(largestStep(afterOn, 'autotune', 0.5)).toBeLessThanOrEqual(0.5 * BLEND_STEP_PER_UNIT);
    expect(final(steps).values.autotune).toBe(1);
  });

  it('stays on the slider when switched to gesture while the hand is away', () => {
    const resolver = new ControlResolver();
    const steps = simulate(
      resolver,
      0,
      1000,
      (timeMs) => gestureFrame(timeMs, { status: 'lost', openness: 1 }),
      (timeMs) =>
        config({ autotune: { source: timeMs < 500 ? 'manual' : 'gesture', manual: 0.25 } }),
    );
    for (const { result } of steps) {
      expect(result.values.autotune).toBe(0.25);
      expect(result.status.autotune).toBe('manual');
    }
  });
});

describe('ControlResolver — detection flickers', () => {
  /**
   * A fist that has been tracked for two seconds opens fully at time zero, watched by a 30 fps
   * tracker that misses the frames picked by `isMissed`, with the real gesture pipeline in
   * between. Reports how long autotune takes to reach 0.9 and the largest step it makes.
   */
  function followOpeningHand(
    isMissed: (frameIndex: number) => boolean,
    resolveHz: number,
  ): { lagMs: number; largestStep: number } {
    const pipeline = new GesturePipeline();
    const resolver = new ControlResolver();
    const warmUpFrames = 60;
    let latest: GestureFrame | null = null;
    let framesFed = 0;
    let previous: number | null = null;
    let largestStep = 0;
    for (let tick = 0; tick < 6 * resolveHz; tick += 1) {
      const timeMs = (tick * 1000) / resolveHz - warmUpFrames * FRAME_MS;
      // Every tracker frame that is due by now.
      while ((framesFed - warmUpFrames) * FRAME_MS <= timeMs + 1e-6) {
        const frameMs = (framesFed - warmUpFrames) * FRAME_MS;
        const hands = isMissed(framesFed) ? [] : [syntheticHand({ closure: frameMs < 0 ? 1 : 0 })];
        latest = pipeline.update(syntheticFrame(frameMs, hands));
        framesFed += 1;
      }
      const { values } = resolver.resolve(latest, config(), timeMs);
      if (previous !== null)
        largestStep = Math.max(largestStep, Math.abs(values.autotune - previous));
      previous = values.autotune;
      if (timeMs >= 0 && values.autotune >= 0.9) return { lagMs: timeMs, largestStep };
    }
    return { lagMs: Number.POSITIVE_INFINITY, largestStep };
  }

  /** Frames to miss: each with probability `rate`, but never two in a row. */
  function randomDropouts(rate: number, seed: number): (frameIndex: number) => boolean {
    const random = seededRandom(seed);
    const missed = new Set<number>();
    for (let frame = 0; frame < 400; frame += 1) {
      if (!missed.has(frame - 1) && random() < rate) missed.add(frame);
    }
    return (frameIndex) => missed.has(frameIndex);
  }

  it('follows an unbroken hand within a tenth of a second', () => {
    expect(followOpeningHand(() => false, 60).lagMs).toBeLessThanOrEqual(100);
  });

  it('keeps up with the hand when one detection in five, three or two is missed', () => {
    // Detection flickers like this when a hand is near the edge of what the tracker can see,
    // which is just where the volume gesture takes it. A control that began a fresh blend
    // after every missed frame would trail the hand by seconds here.
    for (const resolveHz of [60, 30]) {
      const ceiling = MAX_CONTROL_SPEED_PER_SEC / resolveHz + 1e-9;
      for (const rate of [0.2, 0.3, 0.5]) {
        for (let seed = 1; seed <= 10; seed += 1) {
          const { lagMs, largestStep } = followOpeningHand(randomDropouts(rate, seed), resolveHz);
          expect(
            lagMs,
            `${resolveHz} Hz, ${rate * 100} % missed, seed ${seed}`,
          ).toBeLessThanOrEqual(250);
          expect(largestStep).toBeLessThanOrEqual(ceiling);
        }
      }
    }
  });

  it('keeps up even when every other detection is missed', () => {
    for (const resolveHz of [60, 30]) {
      const { lagMs, largestStep } = followOpeningHand((frame) => frame % 2 === 1, resolveHz);
      expect(lagMs, `${resolveHz} Hz`).toBeLessThanOrEqual(250);
      expect(largestStep).toBeLessThanOrEqual(MAX_CONTROL_SPEED_PER_SEC / resolveHz + 1e-9);
    }
  });

  it('picks the hand up at full speed, not with a new blend, after a brief dropout', () => {
    const resolver = new ControlResolver();
    simulate(resolver, 0, 600, (timeMs) => gestureFrame(timeMs, { openness: 0 }));
    // Two frames are missed; when the hand is seen again it has opened.
    const backAtMs = 600 + 2 * FRAME_MS;
    const steps = simulate(resolver, 600, 400, (timeMs) =>
      timeMs < backAtMs - 1
        ? gestureFrame(timeMs, { status: 'holding', openness: 0 })
        : gestureFrame(timeMs, { openness: 1 }),
    );
    expect(steps[0]?.result.status.autotune).toBe('holding');
    expect(steps[1]?.result.values.autotune).toBe(0);
    const arrived = steps.find((step) => step.result.values.autotune === 1);
    // The speed ceiling crosses the whole range in 100 ms; a blend would take 250 ms.
    expect((arrived?.timeMs ?? Infinity) - backAtMs).toBeLessThanOrEqual(100 + FRAME_MS);
    expect(largestStep(steps, 'autotune', 0)).toBeLessThanOrEqual(MAX_STEP_PER_FRAME);
  });

  it('carries an interrupted blend on from where it stopped', () => {
    const resolver = new ControlResolver();
    // The hand appears wide open, but only every other frame catches it.
    const steps = simulate(resolver, 0, 1000, (timeMs) => {
      const seen = Math.round(timeMs / FRAME_MS) % 2 === 0;
      return gestureFrame(timeMs, { status: seen ? 'tracking' : 'holding', openness: 1 });
    });
    let previous = 0.5;
    for (const { result } of steps) {
      const { autotune } = result.values;
      // Frozen while the hand is not seen, and otherwise only ever closing in on it.
      if (result.status.autotune === 'holding') expect(autotune).toBe(previous);
      else expect(autotune).toBeGreaterThanOrEqual(previous);
      previous = autotune;
    }
    // Every step is one the blend itself would take: no lurch to make up for the pauses.
    expect(largestStep(steps, 'autotune', 0.5)).toBeLessThanOrEqual(0.5 * BLEND_STEP_PER_UNIT);
    // Only time with the hand in view counts, so the blend takes twice as long as usual.
    const arrived = steps.find((step) => step.result.values.autotune === 1);
    expect(arrived?.timeMs).toBeGreaterThan(RECOVERY_BLEND_MS);
    expect(arrived?.timeMs).toBeLessThanOrEqual(2 * RECOVERY_BLEND_MS + 2 * FRAME_MS);
  });
});

describe('ControlResolver — sparse sightings', () => {
  it('reaches the hand even when it is seen only once every 300 ms', () => {
    // Each sighting is far enough apart to count as a new appearance; the blend must carry on
    // across them rather than start again from zero every time.
    const pipeline = new GesturePipeline();
    const resolver = new ControlResolver();
    let latest: GestureFrame | null = null;
    let framesFed = 0;
    let reachedAtMs: number | null = null;
    for (let tick = 0; tick < 60 * 6; tick += 1) {
      const timeMs = (tick * 1000) / 60;
      while (framesFed * FRAME_MS <= timeMs + 1e-6) {
        const seen = framesFed % 9 === 0;
        const hands = seen ? [syntheticHand({ closure: 0 })] : [];
        latest = pipeline.update(syntheticFrame(framesFed * FRAME_MS, hands));
        framesFed += 1;
      }
      const { values } = resolver.resolve(latest, config(), timeMs);
      if (reachedAtMs === null && values.autotune === 1) reachedAtMs = timeMs;
    }
    expect(reachedAtMs).not.toBeNull();
    expect(reachedAtMs ?? Infinity).toBeLessThan(4000);
  });
});

describe('ControlResolver — slow callers', () => {
  it('never moves a control by more than MAX_CONTROL_STEP in one call', () => {
    for (const intervalMs of [100, 250]) {
      const resolver = new ControlResolver();
      const results: number[] = [];
      for (let call = 0; call < 40; call += 1) {
        const timeMs = call * intervalMs;
        // The hand flips between shut and open every ten calls.
        const openness = Math.floor(call / 10) % 2 === 0 ? 0 : 1;
        results.push(
          resolver.resolve(gestureFrame(timeMs, { openness }), config(), timeMs).values.autotune,
        );
      }
      for (let index = 1; index < results.length; index += 1) {
        const change = Math.abs((results[index] ?? 0) - (results[index - 1] ?? 0));
        expect(change, `every ${intervalMs} ms`).toBeLessThanOrEqual(MAX_CONTROL_STEP + 1e-12);
      }
      expect(results[9]).toBe(0);
      expect(results[19]).toBe(1);
    }
  });

  it('still reaches the hand when called only a few times a second', () => {
    for (const intervalMs of [250, 300, 500]) {
      const resolver = new ControlResolver();
      const results: ResolvedControls[] = [];
      for (let call = 0; call < 6; call += 1) {
        const timeMs = call * intervalMs;
        results.push(resolver.resolve(gestureFrame(timeMs, { openness: 1 }), config(), timeMs));
      }
      expect(results[0]?.values.autotune).toBe(0.5);
      // A blend spans three calls at most (each call accounts for up to 100 ms).
      expect(results[4]?.values.autotune, `every ${intervalMs} ms`).toBe(1);
      expect(results[5]?.values.autotune).toBe(1);
      for (const result of results) expect(result.status.autotune).toBe('gesture');
    }
  });

  it('follows a moving hand when called only a few times a second', () => {
    const resolver = new ControlResolver();
    let latest = 0;
    for (let call = 0; call < 40; call += 1) {
      const timeMs = call * 300;
      // The hand closes slowly over the first six seconds and then stays shut.
      const openness = Math.max(0, 1 - timeMs / 6000);
      latest = resolver.resolve(gestureFrame(timeMs, { openness }), config(), timeMs).values
        .autotune;
      if (timeMs > 1500 && timeMs < 6000) expect(Math.abs(latest - openness)).toBeLessThan(0.25);
    }
    expect(latest).toBe(0);
  });
});

describe('ControlResolver — unusable numbers', () => {
  const steadyHands = (timeMs: number): GestureFrame =>
    gestureFrame(timeMs, { openness: 0.9, proximity: 0.8 }, { openness: 0.7 });

  it('treats a hand whose value is not a number as lost, and follows it again afterwards', () => {
    for (const broken of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const resolver = new ControlResolver();
      const steps = simulate(resolver, 0, 2000, (timeMs) =>
        timeMs >= 600 && timeMs < 700
          ? gestureFrame(timeMs, { openness: broken, proximity: broken }, { openness: 0.7 })
          : steadyHands(timeMs),
      );
      for (const { timeMs, result } of steps) {
        expectUsableValues(result);
        if (timeMs >= 600 && timeMs < 700) {
          expect(result.status.autotune, `openness ${broken}`).toBe('returning');
          expect(result.status.volume).toBe('returning');
          // The other hand is untouched.
          expect(result.status.echo).toBe('gesture');
        }
      }
      // Three bad frames are not a jump: the values barely leave the hand and blend back.
      expect(largestStep(steps.slice(10), 'autotune')).toBeLessThan(0.01);
      expect(final(steps).values.autotune).toBeCloseTo(0.9, 9);
      expect(final(steps).values.volume).toBeCloseTo(0.8, 9);
      expect(final(steps).status.autotune).toBe('gesture');
    }
  });

  it('uses the default slider position for a slider value that is not a number', () => {
    const resolver = new ControlResolver();
    const settings = config({
      autotune: { source: 'manual', manual: Number.NaN },
      // Gesture-driven, but its hand is lost, so it rests on the slider.
      echo: { source: 'gesture', manual: Number.POSITIVE_INFINITY },
      volume: { source: 'manual', manual: Number.NEGATIVE_INFINITY },
    });
    const steps = simulate(
      resolver,
      0,
      300,
      (timeMs) => gestureFrame(timeMs, {}, { status: 'lost' }),
      settings,
    );
    for (const { result } of steps) {
      expect(result.values).toEqual({
        autotune: DEFAULT_SETTINGS.controls.autotune.manual,
        echo: DEFAULT_SETTINGS.controls.echo.manual,
        volume: DEFAULT_SETTINGS.controls.volume.manual,
      });
    }
  });

  it('is not thrown by a clock reading that is not a number', () => {
    const resolver = new ControlResolver();
    const before = final(simulate(resolver, 0, 600, steadyHands));
    for (const badTime of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const during = resolver.resolve(steadyHands(600), config(), badTime);
      expect(during.values).toEqual(before.values);
    }
    // Time carries on from the last good reading: the hand vanishes and the usual hold and
    // return follow on schedule.
    const steps = simulate(resolver, 600, 3500, (timeMs) => {
      const status = timeMs - 600 < HOLD_DURATION_MS ? 'holding' : 'lost';
      return gestureFrame(timeMs, { status, openness: 0.9, proximity: 0.8 }, { openness: 0.7 });
    });
    for (const { result } of steps) expectUsableValues(result);
    const restingAt = steps.find((step) => step.result.status.autotune === 'manual');
    expect(restingAt?.timeMs).toBeGreaterThan(600 + HOLD_DURATION_MS + RETURN_TO_MANUAL_MS - 50);
    expect(restingAt?.timeMs).toBeLessThan(600 + HOLD_DURATION_MS + RETURN_TO_MANUAL_MS + 100);
    expect(final(steps).values.autotune).toBe(0.5);
  });

  it('does not let a caller that mixes two clocks speed time up', () => {
    // Every other call is stamped 30 ms earlier, e.g. a frame timestamp instead of the time now.
    const resolver = new ControlResolver();
    simulate(resolver, 0, 600, (timeMs) => gestureFrame(timeMs, { openness: 1 }));
    let restingAtMs: number | null = null;
    for (let call = 0; call < 6 * 60; call += 1) {
      const timeMs = 600 + (call * 1000) / 60;
      const stampMs = call % 2 === 0 ? timeMs : timeMs - 30;
      const { status } = resolver.resolve(
        gestureFrame(600, { status: 'lost', openness: 1 }),
        config(),
        stampMs,
      );
      if (restingAtMs === null && status.autotune === 'manual') restingAtMs = timeMs;
    }
    expect(restingAtMs).not.toBeNull();
    expect((restingAtMs ?? 0) - 600).toBeGreaterThan(RETURN_TO_MANUAL_MS - 50);
  });

  it('carries on from a clock that was reset to an earlier time', () => {
    const resolver = new ControlResolver();
    simulate(resolver, 50_000, 600, (timeMs) => gestureFrame(timeMs, { openness: 1 }));
    // The clock restarts from zero; the hand is gone, so the control returns to the slider.
    const steps = simulate(resolver, 0, 2000, (timeMs) =>
      gestureFrame(timeMs, { status: 'lost', openness: 1 }),
    );
    expect(final(steps).status.autotune).toBe('manual');
    expect(final(steps).values.autotune).toBe(0.5);
  });

  it('still notices a stalled tracker whose frame is stamped with something that is not a number', () => {
    const resolver = new ControlResolver();
    simulate(resolver, 0, 600, (timeMs) => gestureFrame(timeMs, { openness: 1 }));
    const frozen = gestureFrame(Number.NaN, { openness: 1 });
    const steps = simulate(resolver, 600, 3500, () => frozen);
    expect(final(steps).status.autotune).toBe('manual');
    expect(final(steps).values.autotune).toBe(0.5);
  });

  it('returns usable values whatever it is fed, and recovers at once', () => {
    const resolver = new ControlResolver();
    const random = seededRandom(2024);
    const garbage = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -3, 7, 1e300];
    const maybeGarbage = (value: number): number => {
      const roll = random();
      const picked = garbage[Math.floor(random() * garbage.length)];
      return roll < 0.3 && picked !== undefined ? picked : value;
    };
    const statuses = ['tracking', 'holding', 'lost'] as const;
    for (let index = 0; index < 2000; index += 1) {
      const timeMs = index * FRAME_MS;
      const status = statuses[Math.floor(random() * statuses.length)] ?? 'tracking';
      const frame =
        random() < 0.1
          ? null
          : gestureFrame(
              maybeGarbage(timeMs),
              { status, openness: maybeGarbage(random()), proximity: maybeGarbage(random()) },
              { status, openness: maybeGarbage(random()) },
            );
      const settings = config({
        autotune: { source: 'gesture', manual: maybeGarbage(0.5) },
        echo: { source: random() < 0.5 ? 'gesture' : 'manual', manual: maybeGarbage(0.2) },
        volume: { source: 'gesture', manual: maybeGarbage(0.5) },
      });
      expectUsableValues(resolver.resolve(frame, settings, maybeGarbage(timeMs)));
    }

    const recovered = simulate(resolver, 2000 * FRAME_MS, 1500, steadyHands);
    for (const { result } of recovered) expectUsableValues(result);
    expect(final(recovered).values.autotune).toBeCloseTo(0.9, 9);
    expect(final(recovered).values.volume).toBeCloseTo(0.8, 9);
    expect(final(recovered).values.echo).toBeCloseTo(0.7, 9);
    expect(final(recovered).status).toEqual({
      autotune: 'gesture',
      echo: 'gesture',
      volume: 'gesture',
    });
  });
});

describe('ControlResolver — tracker stalls', () => {
  it('holds and then returns to manual when no new frame arrives', () => {
    const resolver = new ControlResolver();
    simulate(resolver, 0, 1000, (timeMs) => gestureFrame(timeMs, { openness: 1 }));
    // The tracker freezes: the same "tracking" frame is all there is from now on.
    const frozen = gestureFrame(1000, { openness: 1 });
    const steps = simulate(resolver, 1000, 3500, () => frozen);

    const statusAt = (ms: number): string | undefined =>
      steps.find((step) => step.timeMs >= 1000 + ms)?.result.status.autotune;
    expect(statusAt(100)).toBe('gesture');
    expect(statusAt(400)).toBe('holding');
    expect(statusAt(HOLD_DURATION_MS + 300)).toBe('returning');
    expect(final(steps).status.autotune).toBe('manual');
    expect(final(steps).values.autotune).toBe(0.5);
    expect(largestStep(steps, 'autotune', 1)).toBeLessThan(0.02);
  });

  it('eases to manual when the frames stop altogether', () => {
    const resolver = new ControlResolver();
    simulate(resolver, 0, 1000, (timeMs) => gestureFrame(timeMs, { openness: 1 }));
    const steps = simulate(resolver, 1000, 2500, () => null);
    expect(steps[0]?.result.status.autotune).toBe('returning');
    expect(largestStep(steps, 'autotune', 1)).toBeLessThan(0.02);
    expect(final(steps).values.autotune).toBe(0.5);
  });
});

describe('ControlResolver — with the real gesture pipeline', () => {
  it('never jumps through appear → vanish → return to manual → reappear in another pose', () => {
    const pipeline = new GesturePipeline({ neutralHandScale: 0.2 });
    const resolver = new ControlResolver();
    const settings = config();

    const handsAt = (timeMs: number): RawHand[] => {
      const left = syntheticHand({ side: 'left', centre: { x: 0.72, y: 0.5 }, closure: 0.55 });
      // Right hand: open and near until 2 s; gone until 6 s; back as a far fist.
      if (timeMs < 2000) {
        return [left, syntheticHand({ centre: { x: 0.28, y: 0.5 }, closure: 0, palmScale: 0.32 })];
      }
      if (timeMs < 6000) return [left];
      return [left, syntheticHand({ centre: { x: 0.3, y: 0.55 }, closure: 1, palmScale: 0.12 })];
    };

    const steps = simulate(
      resolver,
      0,
      8000,
      (timeMs) => pipeline.update(syntheticFrame(timeMs, handsAt(timeMs))),
      settings,
    );

    for (const control of CONTROL_IDS) {
      expect(largestStep(steps, control)).toBeLessThanOrEqual(BLEND_STEP_PER_UNIT);
    }

    const at = (ms: number): ResolvedControls => {
      const step = steps.find((candidate) => candidate.timeMs >= ms);
      if (!step) throw new Error(`no step at ${ms}`);
      return step.result;
    };
    // Tracking: open hand → full autotune; 1.6× the neutral size → louder than unity.
    expect(at(1500).status.autotune).toBe('gesture');
    expect(at(1500).values.autotune).toBe(1);
    expect(at(1500).values.volume).toBeGreaterThan(0.8);
    // Just vanished: held.
    expect(at(2400).status.autotune).toBe('holding');
    expect(at(2400).values.autotune).toBe(1);
    expect(at(2400).values.volume).toBe(at(1500).values.volume);
    // Lost: on the way back to the sliders, then resting on them.
    expect(at(2000 + HOLD_DURATION_MS + 600).status.volume).toBe('returning');
    expect(at(5000).status).toMatchObject({ autotune: 'manual', volume: 'manual' });
    expect(at(5000).values.autotune).toBe(0.5);
    expect(at(5000).values.volume).toBe(0.5);
    // The left hand was there throughout.
    expect(at(5000).status.echo).toBe('gesture');
    // Back as a far fist: no autotune, quieter than unity.
    expect(at(7500).status.autotune).toBe('gesture');
    expect(at(7500).values.autotune).toBe(0);
    expect(at(7500).values.volume).toBeLessThan(0.2);
  });

  it('leaves the other hand’s control alone when a hand’s first frame is mislabelled', () => {
    // Labels are least reliable as a hand comes into view. This right hand's first frame says
    // 'Left'; if that were believed even briefly, the echo (left hand) would swell and then
    // take over two seconds to settle back.
    for (const firstScore of [0.9, 0.6]) {
      const pipeline = new GesturePipeline();
      const resolver = new ControlResolver();
      const settings = config({ echo: { source: 'gesture', manual: 0 } });
      const steps = simulate(
        resolver,
        0,
        3000,
        (timeMs) => {
          const first = timeMs < FRAME_MS / 2;
          const hand = syntheticHand({
            closure: 0,
            ...(first ? { label: 'Left' as const, score: firstScore } : {}),
          });
          return pipeline.update(syntheticFrame(timeMs, [hand]));
        },
        settings,
      );
      for (const { result } of steps) {
        expect(result.values.echo, `first score ${firstScore}`).toBe(0);
        expect(result.status.echo).toBe('manual');
      }
      expect(final(steps).values.autotune).toBe(1);
      expect(final(steps).status.autotune).toBe('gesture');
    }
  });

  it('stays smooth when called at 60 Hz with 30 Hz tracker frames', () => {
    const pipeline = new GesturePipeline();
    const resolver = new ControlResolver();
    let latest: GestureFrame | null = null;
    let previous: number | null = null;
    let largest = 0;
    for (let tick = 0; tick < 360; tick += 1) {
      const timeMs = (tick * 1000) / 60;
      if (tick % 2 === 0) {
        // The hand opens and closes about once a second and vanishes for a while in the middle.
        const visible = timeMs < 2000 || timeMs > 3500;
        const closure = 0.5 + 0.5 * Math.sin(timeMs / 160);
        latest = pipeline.update(
          syntheticFrame(timeMs, visible ? [syntheticHand({ closure })] : []),
        );
      }
      const { values } = resolver.resolve(latest, config(), timeMs);
      if (previous !== null) largest = Math.max(largest, Math.abs(values.autotune - previous));
      previous = values.autotune;
    }
    expect(largest).toBeLessThanOrEqual((MAX_CONTROL_SPEED_PER_SEC * (1000 / 60)) / 1000 + 1e-9);
    expect(largest).toBeGreaterThan(0.01);
  });
});

describe('ControlResolver — reset', () => {
  it('forgets transitions in progress', () => {
    const resolver = new ControlResolver();
    simulate(resolver, 0, 1000, (timeMs) => gestureFrame(timeMs, { openness: 1 }));
    resolver.reset();
    const { values, status } = resolver.resolve(
      gestureFrame(1000, { status: 'lost', openness: 1 }),
      config(),
      1000,
    );
    expect(values.autotune).toBe(0.5);
    expect(status.autotune).toBe('manual');
  });
});
