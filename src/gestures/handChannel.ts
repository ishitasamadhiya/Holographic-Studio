import type { HandSide } from '@shared/controls';
import { measureHandConfidence, MIN_TRACKING_CONFIDENCE } from './confidence';
import { DeadBand } from './deadBand';
import { measureHandScale } from './handScale';
import { OneEuroFilter } from './oneEuroFilter';
import { measureHandExtension, opennessFromExtension } from './openness';
import { proximityOnAxis, scaleToProximityAxis } from './proximity';
import type { HandState, HandStatus, Landmark, RawHand } from './types';

/** How long a vanished hand's values are held before the hand counts as lost. */
export const HOLD_DURATION_MS = 800;

/** Changes smaller than this (as a fraction of the 0..1 range) are treated as tremor. */
const DEAD_BAND_WIDTH = 0.012;

interface HandMeasurement {
  /** See measureHandExtension. */
  extension: number;
  /** See measureHandScale. */
  scale: number;
}

/**
 * The raw measurements of one detection, or null when its landmarks do not yield usable
 * numbers. A palm collapsed to a point, for one, has size zero, which sits at minus infinity
 * on the proximity axis; such a detection is held over like an unreliable one, not measured.
 */
function measureHand(hand: RawHand, imageAspect: number): HandMeasurement | null {
  const extension = measureHandExtension(hand);
  const scale = measureHandScale(hand.landmarks, imageAspect);
  const usable = Number.isFinite(extension) && Number.isFinite(scale) && scale > 0;
  return usable ? { extension, scale } : null;
}

/**
 * The smoothed measurements and the tracking / holding / lost state of one of the performer's
 * hands. Driven purely by the timestamps of the frames it is given.
 */
export class HandChannel {
  private readonly side: HandSide;
  private readonly extensionFilter = new OneEuroFilter();
  private readonly proximityFilter = new OneEuroFilter();
  private readonly opennessBand = new DeadBand(DEAD_BAND_WIDTH);
  private readonly proximityBand = new DeadBand(DEAD_BAND_WIDTH);

  private status: HandStatus = 'lost';
  private openness = 0;
  private proximity = 0.5;
  private scale = 0;
  private lastReliableMs = 0;

  constructor(side: HandSide) {
    this.side = side;
  }

  /**
   * Advances to the frame at `timestampMs` (a finite number). `hand` is this side's detection
   * in that frame, or null when the hand was not found.
   */
  update(
    hand: RawHand | null,
    timestampMs: number,
    imageAspect: number,
    neutralScale: number,
  ): HandState {
    const measurement = hand ? measureHand(hand, imageAspect) : null;
    // Landmarks that cannot even be measured deserve no confidence at all.
    const confidence = hand && measurement ? measureHandConfidence(hand) : 0;

    if (measurement && confidence >= MIN_TRACKING_CONFIDENCE) {
      // After a real absence the old filter state describes a pose from long ago; start
      // afresh from what is seen now. (Across a brief hold the state is still relevant.)
      if (this.status === 'lost') this.resetSmoothing();

      const extension = this.extensionFilter.filter(measurement.extension, timestampMs);
      this.openness = this.opennessBand.update(opennessFromExtension(extension));

      this.scale = measurement.scale;
      const axisPosition = this.proximityFilter.filter(
        scaleToProximityAxis(this.scale),
        timestampMs,
      );
      this.proximity = this.proximityBand.update(proximityOnAxis(axisPosition, neutralScale));

      this.status = 'tracking';
      this.lastReliableMs = timestampMs;
    } else if (this.status !== 'lost') {
      const heldForMs = timestampMs - this.lastReliableMs;
      this.status = heldForMs >= HOLD_DURATION_MS ? 'lost' : 'holding';
    }

    return this.describe(confidence, hand ? hand.landmarks : null);
  }

  /** The hand as it stands, without a detection: what is reported when a frame is unusable. */
  snapshot(): HandState {
    return this.describe(0, null);
  }

  /**
   * Call when the neutral scale changes. The dead-band would otherwise leave proximity resting
   * up to one band-width short of its new value, and a fresh calibration should read exactly 0.5.
   */
  recentreProximity(): void {
    this.proximityBand.reset();
  }

  reset(): void {
    this.resetSmoothing();
    this.status = 'lost';
    this.openness = 0;
    this.proximity = 0.5;
    this.scale = 0;
    this.lastReliableMs = 0;
  }

  private describe(confidence: number, landmarks: Landmark[] | null): HandState {
    return {
      side: this.side,
      status: this.status,
      openness: this.openness,
      proximity: this.proximity,
      scale: this.scale,
      confidence,
      landmarks,
    };
  }

  private resetSmoothing(): void {
    this.extensionFilter.reset();
    this.proximityFilter.reset();
    this.opennessBand.reset();
    this.proximityBand.reset();
  }
}
