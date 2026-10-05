// MediaPipe's 21-point hand model: index 0 is the wrist, then four points per digit running
// from the base of the digit to its tip.

export const LANDMARK_COUNT = 21;
export const WRIST = 0;

export type FingerName = 'index' | 'middle' | 'ring' | 'pinky';
export const FINGER_NAMES: readonly FingerName[] = ['index', 'middle', 'ring', 'pinky'];

/** Landmark indices along one digit, from its knuckle to its tip. */
export interface DigitJoints {
  /** Knuckle (MCP) for a finger; CMC for the thumb. */
  base: number;
  /** PIP for a finger; MCP for the thumb. */
  middle: number;
  /** DIP for a finger; IP for the thumb. */
  distal: number;
  tip: number;
}

export const THUMB: DigitJoints = { base: 1, middle: 2, distal: 3, tip: 4 };

export const FINGERS: Record<FingerName, DigitJoints> = {
  index: { base: 5, middle: 6, distal: 7, tip: 8 },
  middle: { base: 9, middle: 10, distal: 11, tip: 12 },
  ring: { base: 13, middle: 14, distal: 15, tip: 16 },
  pinky: { base: 17, middle: 18, distal: 19, tip: 20 },
};

/** The rigid part of the hand: the wrist and the four knuckles. Unaffected by finger pose. */
export const PALM_LANDMARKS: readonly number[] = [
  WRIST,
  FINGERS.index.base,
  FINGERS.middle.base,
  FINGERS.ring.base,
  FINGERS.pinky.base,
];

function digitBones(digit: DigitJoints): Array<readonly [number, number]> {
  return [
    [digit.base, digit.middle],
    [digit.middle, digit.distal],
    [digit.distal, digit.tip],
  ];
}

/** Landmark pairs to connect when drawing the hand skeleton. */
export const HAND_BONES: ReadonlyArray<readonly [number, number]> = [
  [WRIST, THUMB.base],
  ...digitBones(THUMB),
  [WRIST, FINGERS.index.base],
  ...digitBones(FINGERS.index),
  [FINGERS.index.base, FINGERS.middle.base],
  ...digitBones(FINGERS.middle),
  [FINGERS.middle.base, FINGERS.ring.base],
  ...digitBones(FINGERS.ring),
  [FINGERS.ring.base, FINGERS.pinky.base],
  ...digitBones(FINGERS.pinky),
  [WRIST, FINGERS.pinky.base],
];
