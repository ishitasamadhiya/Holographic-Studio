// Control resolution: turns the hands' gesture values and the user's settings into the three
// control values that are sent to the audio engine. This is where a lost hand is handled, so
// that an effect never jumps: hold, then ease back to the manual slider, then blend back in.
import {
  clamp01,
  CONTROL_IDS,
  DEFAULT_GESTURE_BINDINGS,
  type ControlId,
  type ControlValues,
  type GestureBinding,
} from '@shared/controls';
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings';
import { HOLD_DURATION_MS } from './handChannel';
import type { GestureFrame, HandStatus } from './types';

/**
 * gesture:   following the hand.
 * holding:   the hand is not seen right now; the value is frozen. This can last a single
 *            frame when a detection is missed, so show it only once it persists.
 * returning: the hand is lost; the value is easing to the manual slider.
 * manual:    the value is the manual slider (by choice, or because the hand is gone).
 */
export type ControlStatus = 'gesture' | 'holding' | 'returning' | 'manual';

export interface ResolvedControls {
  values: ControlValues;
  status: Record<ControlId, ControlStatus>;
}

export interface ControlResolverConfig {
  /** Video mode AND the camera is running AND the tracker is healthy. */
  gesturesAvailable: boolean;
  controls: Settings['controls'];
}

/** How long a control takes to ease to its manual value once its hand is lost. */
export const RETURN_TO_MANUAL_MS = 1500;
/**
 * How long a control takes to blend onto the live gesture value when its hand appears, or
 * reappears after more than a brief dropout. Only time with the hand in view counts.
 */
export const RECOVERY_BLEND_MS = 250;
/**
 * Hard ceiling on how fast a gesture-driven control may move, in full ranges per second.
 * Real gestures stay well below it; it is the last line of defence against a discontinuity
 * in the tracking (the two hands being re-identified, a recalibration) reaching the audio.
 */
export const MAX_CONTROL_SPEED_PER_SEC = 10;
/**
 * Largest change of a gesture-driven control in one resolve() call, whatever the call rate: the
 * speed ceiling's step at 30 calls a second. Faster callers are held to the speed ceiling; this
 * keeps a slower one (a timer standing in for animation frames in a hidden window) from moving
 * a control in big steps.
 */
export const MAX_CONTROL_STEP = MAX_CONTROL_SPEED_PER_SEC / 30;

/**
 * With no new tracker frame for this long, live values are frozen as if the hand were holding.
 * It is also how long resolve() may go uncalled before the live values count as unknown.
 */
const STALE_FRAME_MS = 250;
/**
 * A hand that went unseen for no longer than this (a few missed detections in a row) is
 * picked up where it was left, without a new blend. Detection flickers when a hand is at the
 * edge of what the tracker can see; blending afresh after every missed frame would keep the
 * control forever at the slow start of a blend, seconds behind the hand. Whatever the hand
 * did during so short a gap is absorbed by the speed ceiling instead.
 */
const BRIEF_DROPOUT_MS = 250;
/**
 * The most time a single resolve() call may account for. When the caller stalls, time inside
 * the resolver simply stops, so every hold, ease and blend carries on from where it was
 * instead of leaping ahead, and the speed ceiling still means something on the next call.
 */
const MAX_STEP_INTERVAL_MS = 100;
/**
 * A clock reading that is behind the latest one by less than this is ignored (a caller mixing
 * two clocks a few frames apart). One further behind means the clock was reset, and time
 * carries on from it.
 */
const CLOCK_RESET_MS = 1000;

/**
 * following: on the manual slider because the control is not gesture-driven right now.
 * live:      on the hand (blending in during the first RECOVERY_BLEND_MS).
 * holding:   frozen while the hand is briefly missing.
 * returning: easing to the manual slider after the hand was lost.
 * resting:   gesture-driven but the hand is lost; sitting on the manual slider.
 */
type Phase = 'following' | 'live' | 'holding' | 'returning' | 'resting';

interface ControlChannel {
  value: number;
  phase: Phase;
  /** Value at which the current blend (live) or ease (returning) began. */
  transitionFrom: number;
  /** How long that blend or ease has been running. A blend only runs while the hand is seen. */
  transitionElapsedMs: number;
  /** When the tracker frame that last showed this control's hand as tracked arrived. */
  handSeenMs: number;
}

/** How much one resolve() call may change things. */
interface TimeStep {
  /** Time this call accounts for. */
  ms: number;
  /** Largest change of a control value allowed by the speed ceiling. */
  maxChange: number;
  /** True when resolve() itself went uncalled for so long that the hand may be anywhere. */
  stalled: boolean;
}

function smoothstep(progress: number): number {
  const t = clamp01(progress);
  return t * t * (3 - 2 * t);
}

/** Eases from one value to another; lands on `to` exactly once the transition is complete. */
function ease(from: number, to: number, progress: number): number {
  return progress >= 1 ? to : from + (to - from) * smoothstep(progress);
}

function moveToward(current: number, target: number, maxStep: number): number {
  const offset = target - current;
  return Math.abs(offset) <= maxStep ? target : current + Math.sign(offset) * maxStep;
}

function beginTransition(channel: ControlChannel, phase: 'live' | 'returning'): void {
  channel.phase = phase;
  channel.transitionFrom = channel.value;
  channel.transitionElapsedMs = 0;
}

/** The slider value to use: clamped, and the factory default if the setting is not a number. */
function usableManual(control: ControlId, manual: number): number {
  return Number.isFinite(manual) ? clamp01(manual) : DEFAULT_SETTINGS.controls[control].manual;
}

/** The hand's status, downgraded when the frame it came from is no longer fresh. */
function statusAtAge(status: HandStatus, frameAgeMs: number): HandStatus {
  if (frameAgeMs >= HOLD_DURATION_MS) return 'lost';
  if (frameAgeMs >= STALE_FRAME_MS && status === 'tracking') return 'holding';
  return status;
}

export class ControlResolver {
  private readonly bindings = new Map<ControlId, GestureBinding>();
  private readonly channels = new Map<ControlId, ControlChannel>();
  private lastResolveMs: number | null = null;
  /** The resolver's own time: the caller's clock with stalls taken out (see MAX_STEP_INTERVAL_MS). */
  private clockMs = 0;
  private latestFrameTimestampMs: number | null = null;
  private latestFrameSeenMs = 0;

  /** When several bindings name the same control, the first one wins. */
  constructor(bindings: readonly GestureBinding[] = DEFAULT_GESTURE_BINDINGS) {
    for (const binding of bindings) {
      if (!this.bindings.has(binding.control)) this.bindings.set(binding.control, binding);
    }
  }

  /**
   * Computes the control values for the moment `nowMs` (any monotonic millisecond clock; it
   * need not be the clock of the frame timestamps). Call it on every animation frame, passing
   * the most recent gesture frame, or null when there is none. It keeps working when called
   * less often (holds, eases and blends then simply take more calls to finish); a gesture-driven
   * value never moves by more than MAX_CONTROL_STEP in one call.
   *
   * The values returned are always finite numbers in 0..1, whatever is passed in.
   */
  resolve(
    frame: GestureFrame | null,
    config: ControlResolverConfig,
    nowMs: number,
  ): ResolvedControls {
    const elapsedMs = this.elapsedSinceLastResolve(nowMs);
    const stepMs = Math.min(elapsedMs, MAX_STEP_INTERVAL_MS);
    this.clockMs += stepMs;
    const step: TimeStep = {
      ms: stepMs,
      maxChange: Math.min(MAX_CONTROL_STEP, (MAX_CONTROL_SPEED_PER_SEC * stepMs) / 1000),
      stalled: elapsedMs >= STALE_FRAME_MS,
    };
    const frameAgeMs = this.observeFrame(frame);
    const gesturesOn = config.gesturesAvailable && config.controls.handControlEnabled;

    const values: ControlValues = { autotune: 0, echo: 0, volume: 0 };
    const status: Record<ControlId, ControlStatus> = {
      autotune: 'manual',
      echo: 'manual',
      volume: 'manual',
    };

    for (const control of CONTROL_IDS) {
      const setting = config.controls[control];
      const manual = usableManual(control, setting.manual);
      const binding = this.bindings.get(control);
      const channel = this.channelFor(control, manual);

      if (!gesturesOn || setting.source !== 'gesture' || !binding) {
        channel.phase = 'following';
        channel.value = manual;
      } else {
        const hand = frame ? frame[binding.hand] : null;
        const live = hand ? hand[binding.feature] : Number.NaN;
        // A hand whose value is not a number cannot be followed: it is as good as lost.
        const handStatus =
          hand && Number.isFinite(live) ? statusAtAge(hand.status, frameAgeMs) : 'lost';
        status[control] = this.advance(channel, handStatus, clamp01(live), manual, step);
      }
      values[control] = channel.value;
    }
    return { values, status };
  }

  /** Forgets all transitions in progress; the next resolve starts from the manual values. */
  reset(): void {
    this.channels.clear();
    this.lastResolveMs = null;
    this.clockMs = 0;
    this.latestFrameTimestampMs = null;
    this.latestFrameSeenMs = 0;
  }

  /**
   * Time since the previous resolve() on the caller's clock. A reading that is not a number, or
   * that runs backwards, counts as no time having passed. A slightly backward reading is not
   * remembered either, so a caller that mixes two clocks cannot make time run faster by going
   * back and forth between them; a far backward one is taken as a reset clock (see CLOCK_RESET_MS).
   */
  private elapsedSinceLastResolve(nowMs: number): number {
    if (!Number.isFinite(nowMs)) return 0;
    const previousMs = this.lastResolveMs;
    if (previousMs !== null && nowMs < previousMs) {
      if (previousMs - nowMs >= CLOCK_RESET_MS) this.lastResolveMs = nowMs;
      return 0;
    }
    this.lastResolveMs = nowMs;
    return previousMs === null ? 0 : nowMs - previousMs;
  }

  private channelFor(control: ControlId, manual: number): ControlChannel {
    let channel = this.channels.get(control);
    if (!channel) {
      channel = {
        value: manual,
        phase: 'following',
        transitionFrom: manual,
        transitionElapsedMs: 0,
        handSeenMs: 0,
      };
      this.channels.set(control, channel);
    }
    return channel;
  }

  /** How long ago the latest gesture frame first arrived. */
  private observeFrame(frame: GestureFrame | null): number {
    if (!frame) {
      this.latestFrameTimestampMs = null;
      return Number.POSITIVE_INFINITY;
    }
    // Object.is, so that a frame stamped NaN is still recognised as the same frame next time.
    if (!Object.is(frame.timestampMs, this.latestFrameTimestampMs)) {
      this.latestFrameTimestampMs = frame.timestampMs;
      this.latestFrameSeenMs = this.clockMs;
    }
    return this.clockMs - this.latestFrameSeenMs;
  }

  /** Moves one gesture-driven control forward in time and reports what it is doing. */
  private advance(
    channel: ControlChannel,
    handStatus: HandStatus,
    live: number,
    manual: number,
    step: TimeStep,
  ): ControlStatus {
    const wasOnHand = channel.phase === 'live' || channel.phase === 'holding';

    if (handStatus === 'tracking') {
      const unseenForMs = this.latestFrameSeenMs - channel.handSeenMs;
      const pickedUp = wasOnHand && !step.stalled && unseenForMs <= BRIEF_DROPOUT_MS;
      // A blend that is under way is never started over, neither by a stalled caller nor by a
      // hold: a hand seen only every few hundred milliseconds, or a caller that only calls that
      // often, would otherwise restart it every time and never arrive.
      const blending = wasOnHand && channel.transitionElapsedMs < RECOVERY_BLEND_MS;
      if (pickedUp || blending) {
        channel.phase = 'live';
        channel.transitionElapsedMs += step.ms;
      } else {
        beginTransition(channel, 'live');
      }
      channel.handSeenMs = this.latestFrameSeenMs;
      const progress = channel.transitionElapsedMs / RECOVERY_BLEND_MS;
      const target = ease(channel.transitionFrom, live, progress);
      channel.value = moveToward(channel.value, target, step.maxChange);
      return 'gesture';
    }

    if (handStatus === 'holding' && wasOnHand) {
      channel.phase = 'holding';
      return 'holding';
    }

    // The hand is lost (or was never there): make for the manual slider.
    if (wasOnHand) beginTransition(channel, 'returning');
    else if (channel.phase === 'returning') channel.transitionElapsedMs += step.ms;
    if (channel.phase === 'returning') {
      const progress = channel.transitionElapsedMs / RETURN_TO_MANUAL_MS;
      const target = ease(channel.transitionFrom, manual, progress);
      channel.value = moveToward(channel.value, target, step.maxChange);
      // Still under way if the slider moved away faster than the control may follow.
      if (progress < 1 || channel.value !== manual) return 'returning';
    }
    channel.phase = 'resting';
    channel.value = manual;
    return 'manual';
  }
}
