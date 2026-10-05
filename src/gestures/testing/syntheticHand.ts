// Test support: a small kinematic model of a hand that produces landmarks in the same form as
// the tracker (image + world), for any pose, size, position and orientation. Proportions follow
// the tracker's output on real hands so that the model exercises the same value ranges.
import type { HandSide } from '@shared/controls';
import { FINGER_NAMES, FINGERS, THUMB, WRIST, type FingerName } from '../handTopology';
import type { Landmark, RawHand, RawHandFrame } from '../types';

export const SYNTHETIC_IMAGE_ASPECT = 16 / 9;

/** Wrist-to-middle-knuckle distance of an average adult hand, in metres. */
const PALM_LENGTH_M = 0.095;

/** A point in the hand's own frame, in palm lengths: along the fingers, toward the thumb, out of the palm. */
type HandPoint = readonly [along: number, thumbward: number, palmward: number];

const KNUCKLES: Record<FingerName, HandPoint> = {
  index: [1.02, 0.28, 0],
  middle: [1, 0, 0],
  ring: [0.92, -0.24, 0],
  pinky: [0.8, -0.45, 0],
};

/** How far each finger fans away from the middle finger, and its three bone lengths. */
const FINGER_SHAPE: Record<FingerName, { splayDeg: number; bones: readonly number[] }> = {
  index: { splayDeg: 6, bones: [0.42, 0.26, 0.22] },
  middle: { splayDeg: 0, bones: [0.46, 0.29, 0.23] },
  ring: { splayDeg: -6, bones: [0.42, 0.28, 0.23] },
  pinky: { splayDeg: -14, bones: [0.33, 0.2, 0.21] },
};

/** Flexion of the knuckle, middle and end joints for a flat hand and for a fist, in degrees. */
const OPEN_FLEXION_DEG = [5, 8, 6] as const;
const FIST_FLEXION_DEG = [75, 105, 85] as const;

/** Thumb joints (base, knuckle, end joint, tip) held out, and folded across the fingers. */
const THUMB_OUT: readonly HandPoint[] = [
  [0.24, 0.38, 0],
  [0.5, 0.62, 0.05],
  [0.72, 0.83, 0.08],
  [0.92, 1, 0.1],
];
const THUMB_TUCKED: readonly HandPoint[] = [
  [0.24, 0.38, 0.05],
  [0.45, 0.45, 0.25],
  [0.62, 0.22, 0.38],
  [0.72, -0.05, 0.42],
];

export interface SyntheticHandOptions {
  /** Which of the performer's hands this is. Default 'right'. */
  side?: HandSide;
  /** 0 = flat open hand, 1 = fist. Applies to every digit unless overridden. Default 0. */
  closure?: number;
  /** Per-finger closure, e.g. to make a victory sign. */
  fingerClosure?: Partial<Record<FingerName, number>>;
  thumbClosure?: number;
  /** Palm centre in normalized image coordinates. Default the middle of the image. */
  centre?: { x: number; y: number };
  /** Apparent palm length as a fraction of image height (what measureHandScale reports). */
  palmScale?: number;
  /** Rotation in the image plane. 0 = fingers pointing up. */
  rollDeg?: number;
  /** Tilt of the fingertips toward (+) or away from (−) the camera. */
  pitchDeg?: number;
  /** Turn of the palm about the hand's long axis. */
  yawDeg?: number;
  /** Anatomical size relative to an average adult hand. */
  handSize?: number;
  imageAspect?: number;
  /** The tracker's label. Defaults to the correct one for `side`. */
  label?: RawHand['label'];
  score?: number;
}

type Vec3 = readonly [number, number, number];

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;

function fingerJoints(finger: FingerName, closure: number): HandPoint[] {
  const { splayDeg, bones } = FINGER_SHAPE[finger];
  const splay = toRadians(splayDeg);
  const joints: HandPoint[] = [KNUCKLES[finger]];
  let bend = 0;
  bones.forEach((length, joint) => {
    bend += toRadians(lerp(OPEN_FLEXION_DEG[joint] ?? 0, FIST_FLEXION_DEG[joint] ?? 0, closure));
    const previous = joints[joints.length - 1] ?? KNUCKLES[finger];
    // Each joint bends the rest of the finger further out of the palm plane, toward the palm.
    joints.push([
      previous[0] + length * Math.cos(bend) * Math.cos(splay),
      previous[1] + length * Math.cos(bend) * Math.sin(splay),
      previous[2] + length * Math.sin(bend),
    ]);
  });
  return joints;
}

function thumbJoints(closure: number): HandPoint[] {
  return THUMB_OUT.map((out, joint) => {
    const tucked = THUMB_TUCKED[joint] ?? out;
    return [
      lerp(out[0], tucked[0], closure),
      lerp(out[1], tucked[1], closure),
      lerp(out[2], tucked[2], closure),
    ];
  });
}

function rotate(point: Vec3, rollDeg: number, pitchDeg: number, yawDeg: number): Vec3 {
  const [x0, y0, z0] = point;
  // Yaw: about the image's vertical axis.
  const yaw = toRadians(yawDeg);
  const x1 = x0 * Math.cos(yaw) + z0 * Math.sin(yaw);
  const z1 = -x0 * Math.sin(yaw) + z0 * Math.cos(yaw);
  // Pitch: about the image's horizontal axis.
  const pitch = toRadians(pitchDeg);
  const y2 = y0 * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = y0 * Math.sin(pitch) + z1 * Math.cos(pitch);
  // Roll: in the image plane.
  const roll = toRadians(rollDeg);
  return [x1 * Math.cos(roll) - y2 * Math.sin(roll), x1 * Math.sin(roll) + y2 * Math.cos(roll), z2];
}

export function syntheticHand(options: SyntheticHandOptions = {}): RawHand {
  const side = options.side ?? 'right';
  const closure = options.closure ?? 0;
  const imageAspect = options.imageAspect ?? SYNTHETIC_IMAGE_ASPECT;
  const palmScale = options.palmScale ?? 0.18;
  const centre = options.centre ?? { x: 0.5, y: 0.5 };
  const palmLength = PALM_LENGTH_M * (options.handSize ?? 1);

  const pose: HandPoint[] = new Array<HandPoint>(21).fill([0, 0, 0]);
  pose[WRIST] = [0, 0, 0];
  thumbJoints(options.thumbClosure ?? closure).forEach((point, joint) => {
    pose[THUMB.base + joint] = point;
  });
  for (const finger of FINGER_NAMES) {
    fingerJoints(finger, options.fingerClosure?.[finger] ?? closure).forEach((point, joint) => {
      pose[FINGERS[finger].base + joint] = point;
    });
  }

  // Into the camera's frame (x right, y down, z away from the camera), palm facing the
  // camera with the fingers up. Seen like that, a right hand's thumb is on the image's right;
  // a left hand is the mirror image.
  const thumbDirection = side === 'right' ? 1 : -1;
  const camera: Vec3[] = pose.map(([along, thumbward, palmward]) =>
    rotate(
      [thumbDirection * thumbward * palmLength, -along * palmLength, -palmward * palmLength],
      options.rollDeg ?? 0,
      options.pitchDeg ?? 0,
      options.yawDeg ?? 0,
    ),
  );

  const mean = (axis: 0 | 1 | 2, points: readonly Vec3[]): number =>
    points.reduce((total, point) => total + point[axis], 0) / points.length;
  const palm = [WRIST, ...FINGER_NAMES.map((finger) => FINGERS[finger].base)].map(
    (index) => camera[index] ?? ([0, 0, 0] as const),
  );
  const palmCentre: Vec3 = [mean(0, palm), mean(1, palm), mean(2, palm)];
  const handCentre: Vec3 = [mean(0, camera), mean(1, camera), mean(2, camera)];

  // Weak-perspective projection: `heightsPerMetre` image heights for every metre.
  const heightsPerMetre = palmScale / palmLength;
  const landmarks: Landmark[] = camera.map(([x, y, z]) => ({
    x: centre.x + ((x - palmCentre[0]) * heightsPerMetre) / imageAspect,
    y: centre.y + (y - palmCentre[1]) * heightsPerMetre,
    z: ((z - palmCentre[2]) * heightsPerMetre) / imageAspect,
  }));
  const worldLandmarks: Landmark[] = camera.map(([x, y, z]) => ({
    x: x - handCentre[0],
    y: y - handCentre[1],
    z: z - handCentre[2],
  }));

  return {
    landmarks,
    worldLandmarks,
    label: options.label ?? (side === 'right' ? 'Right' : 'Left'),
    score: options.score ?? 0.97,
  };
}

export function syntheticFrame(
  timestampMs: number,
  hands: RawHand[],
  imageAspect: number = SYNTHETIC_IMAGE_ASPECT,
): RawHandFrame {
  return { timestampMs, imageAspect, hands };
}
