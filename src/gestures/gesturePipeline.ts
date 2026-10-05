import type { HandSide } from '@shared/controls';
import { HandChannel } from './handChannel';
import { HandednessResolver } from './handedness';
import { resolveNeutralHandScale } from './proximity';
import type { GestureFrame, RawHand, RawHandFrame } from './types';

export interface GesturePipelineOptions {
  /** The performer's calibrated resting hand scale; null or omitted = the default. */
  neutralHandScale?: number | null;
}

/**
 * Turns raw tracker frames into smoothed per-hand gesture values:
 * handedness → confidence gate → openness and scale → One Euro smoothing → dead-band,
 * with hold-then-lost behaviour when a hand disappears. Feed it every tracker frame,
 * including the empty ones: the timestamps of those frames are what drive holding and loss.
 *
 * A hand that has only just come into view is reported from its second confident frame on,
 * once its labels agree on which hand it is. The values it reports are always finite numbers,
 * whatever the tracker sends.
 */
export class GesturePipeline {
  private readonly handedness = new HandednessResolver();
  private readonly left = new HandChannel('left');
  private readonly right = new HandChannel('right');
  private neutralScale: number;
  private latest: GestureFrame | null = null;

  constructor(options: GesturePipelineOptions = {}) {
    this.neutralScale = resolveNeutralHandScale(options.neutralHandScale);
  }

  update(frame: RawHandFrame): GestureFrame {
    // Holding and loss are driven by the timestamps, so a frame that cannot be placed in time
    // is ignored altogether: the caller gets the previous result again.
    if (!Number.isFinite(frame.timestampMs)) return this.latest ?? this.idleFrame();

    // Positions and sizes are measured in image heights, which takes the aspect ratio. Without
    // a usable one the detections mean nothing, and the frame counts as showing no hands.
    const aspectUsable = Number.isFinite(frame.imageAspect) && frame.imageAspect > 0;
    const assignments = aspectUsable ? this.handedness.assign(frame) : [];
    const handFor = (side: HandSide): RawHand | null =>
      assignments.find((assignment) => assignment.side === side)?.hand ?? null;

    this.latest = {
      timestampMs: frame.timestampMs,
      left: this.left.update(
        handFor('left'),
        frame.timestampMs,
        frame.imageAspect,
        this.neutralScale,
      ),
      right: this.right.update(
        handFor('right'),
        frame.timestampMs,
        frame.imageAspect,
        this.neutralScale,
      ),
    };
    return this.latest;
  }

  /** Sets the hand scale that maps to proximity 0.5. null restores the default. */
  setNeutralHandScale(scale: number | null): void {
    this.neutralScale = resolveNeutralHandScale(scale);
    this.left.recentreProximity();
    this.right.recentreProximity();
  }

  /** Forgets everything about the hands seen so far (the neutral scale is kept). */
  reset(): void {
    this.handedness.reset();
    this.left.reset();
    this.right.reset();
    this.latest = null;
  }

  private idleFrame(): GestureFrame {
    return { timestampMs: 0, left: this.left.snapshot(), right: this.right.snapshot() };
  }
}
