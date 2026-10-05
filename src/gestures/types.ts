import type { HandSide } from '@shared/controls';

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** One detected hand exactly as the tracker reports it, before any interpretation. */
export interface RawHand {
  /** 21 points; x/y are 0..1 of the UN-MIRRORED camera image (x grows to the image's right). */
  landmarks: Landmark[];
  /** The same 21 points in metres, centred on the hand, in the camera's orientation. */
  worldLandmarks: Landmark[];
  /**
   * MediaPipe's own label. On un-mirrored frames it is the person's actual hand (verified on
   * real photos; see handedness.ts). Never mirror frames before tracking: that would swap it.
   */
  label: 'Left' | 'Right';
  /** Confidence of that label, 0.5..1. */
  score: number;
}

export interface RawHandFrame {
  /** Capture time on a monotonic millisecond clock (performance.now() in the app). */
  timestampMs: number;
  /** Camera image width / height. */
  imageAspect: number;
  hands: RawHand[];
}

/**
 * tracking: values are live.
 * holding:  the hand vanished (or became unreliable) a moment ago; values are frozen.
 * lost:     the hand has been gone long enough that controls should return to manual.
 */
export type HandStatus = 'tracking' | 'holding' | 'lost';

export interface HandState {
  /** The performer's own hand, not the side of the image it appears on. */
  side: HandSide;
  status: HandStatus;
  /** 0 = closed fist, 1 = fully open hand. */
  openness: number;
  /** 0 = far, 0.5 = the neutral distance, 1 = close. */
  proximity: number;
  /** Raw palm-size measure (see handScale.ts); what calibration records. 0 until first seen. */
  scale: number;
  /** 0..1 for the latest detection; 0 when the hand is not detected. */
  confidence: number;
  /** Latest detected landmarks (for the debug overlay); null when the hand is not detected. */
  landmarks: Landmark[] | null;
}

export interface GestureFrame {
  timestampMs: number;
  left: HandState;
  right: HandState;
}
