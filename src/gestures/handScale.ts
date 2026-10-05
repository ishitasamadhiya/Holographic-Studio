// Hand scale: how large the palm appears in the camera image, as a fraction of image height.
//
// Only the rigid palm (wrist + four knuckles) is used, so opening or closing the fingers does
// not change it. To stay correct when the palm is turned away from the camera, the measurement
// does not read any single distance (each of which shrinks when it tilts out of the image
// plane). Instead it fits the affine map that carries a flat reference palm onto the observed
// palm points. A rigid flat shape seen by a camera is stretched by `s` along the tilt axis and
// by `s·cos(tilt)` across it, so the larger of the map's two stretch factors is the true
// size `s` whichever way the palm is tilted.
import { PALM_LANDMARKS } from './handTopology';
import { landmarkAt } from './landmarkMath';
import type { Landmark } from './types';

/** A point in the image plane with x already aspect-corrected: both axes in image heights. */
export interface ImagePoint {
  x: number;
  y: number;
}

/**
 * The palm landmarks of a hand facing the camera squarely, in the same order as
 * PALM_LANDMARKS, with the wrist at the origin and the middle knuckle at (1, 0). Averaged from
 * the tracker's output on real hands (tests/e2e/fixtures/hands); a left hand, or the back of
 * the hand, is the mirror image, which the fit absorbs.
 */
const REFERENCE_PALM: readonly ImagePoint[] = [
  { x: 0, y: 0 },
  { x: 1.02, y: 0.28 },
  { x: 1, y: 0 },
  { x: 0.92, y: -0.24 },
  { x: 0.8, y: -0.45 },
];

function centroid(points: readonly ImagePoint[]): ImagePoint {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function palmPoints(landmarks: readonly Landmark[], imageAspect: number): ImagePoint[] {
  return PALM_LANDMARKS.map((index) => {
    const landmark = landmarkAt(landmarks, index);
    return { x: landmark.x * imageAspect, y: landmark.y };
  });
}

/** Centre of the palm in the image, in image heights. Used to follow a hand between frames. */
export function palmCentre(landmarks: readonly Landmark[], imageAspect: number): ImagePoint {
  return centroid(palmPoints(landmarks, imageAspect));
}

const referenceCentre = centroid(REFERENCE_PALM);

/**
 * Apparent palm length (wrist to middle knuckle, as if the palm faced the camera squarely) as a
 * fraction of image height. Doubles when the hand halves its distance to the camera.
 */
export function measureHandScale(landmarks: readonly Landmark[], imageAspect: number): number {
  const observed = palmPoints(landmarks, imageAspect);
  const observedCentre = centroid(observed);

  // Least-squares affine fit observed ≈ A · reference: A = (Σ p qᵀ)(Σ q qᵀ)⁻¹ on centred points.
  let pq00 = 0;
  let pq01 = 0;
  let pq10 = 0;
  let pq11 = 0;
  let qq00 = 0;
  let qq01 = 0;
  let qq11 = 0;
  observed.forEach((point, index) => {
    const reference = REFERENCE_PALM[index];
    if (!reference) return;
    const px = point.x - observedCentre.x;
    const py = point.y - observedCentre.y;
    const qx = reference.x - referenceCentre.x;
    const qy = reference.y - referenceCentre.y;
    pq00 += px * qx;
    pq01 += px * qy;
    pq10 += py * qx;
    pq11 += py * qy;
    qq00 += qx * qx;
    qq01 += qx * qy;
    qq11 += qy * qy;
  });
  const determinant = qq00 * qq11 - qq01 * qq01;
  const a = (pq00 * qq11 - pq01 * qq01) / determinant;
  const b = (pq01 * qq00 - pq00 * qq01) / determinant;
  const c = (pq10 * qq11 - pq11 * qq01) / determinant;
  const d = (pq11 * qq00 - pq10 * qq01) / determinant;

  // Largest singular value of the 2×2 matrix [[a, b], [c, d]], in closed form.
  const meanSquare = (a * a + b * b + c * c + d * d) / 2;
  const spread = Math.hypot((a * a + b * b - c * c - d * d) / 2, a * c + b * d);
  return Math.sqrt(meanSquare + spread);
}
