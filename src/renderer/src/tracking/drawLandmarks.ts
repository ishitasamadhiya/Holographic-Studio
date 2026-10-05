import { HAND_BONES } from '@gestures/handTopology';
import type { GestureFrame, HandState } from '@gestures/types';
import type { HandSide } from '@shared/controls';

export interface DrawLandmarksOptions {
  /**
   * Landmarks are in un-mirrored camera coordinates. Set this when the canvas lies over a
   * preview that is mirrored with CSS while the canvas itself is not, so the overlay is
   * flipped to match what the performer sees. Leave it false when the canvas is mirrored by
   * the same CSS as the video.
   */
  mirrored: boolean;
}

/** One quiet tint per hand, so left and right can be told apart at a glance. */
const HAND_TINT: Record<HandSide, string> = {
  left: '120, 200, 255',
  right: '255, 180, 120',
};

const TRACKING_OPACITY = 0.6;
/** A hand that is detected but not trusted (low confidence) is drawn fainter. */
const UNTRUSTED_OPACITY = 0.25;

function drawHand(
  context: CanvasRenderingContext2D,
  hand: HandState,
  options: DrawLandmarksOptions,
): void {
  if (!hand.landmarks) return;
  const { width, height } = context.canvas;
  const points = hand.landmarks.map((landmark) => ({
    x: (options.mirrored ? 1 - landmark.x : landmark.x) * width,
    y: landmark.y * height,
  }));
  const opacity = hand.status === 'tracking' ? TRACKING_OPACITY : UNTRUSTED_OPACITY;
  const colour = `rgba(${HAND_TINT[hand.side]}, ${opacity})`;
  // Sized relative to the canvas so the overlay looks the same at any preview resolution.
  const unit = Math.max(width, height) / 640;

  context.strokeStyle = colour;
  context.fillStyle = colour;
  context.lineWidth = 1.5 * unit;
  context.lineCap = 'round';

  context.beginPath();
  for (const [from, to] of HAND_BONES) {
    const start = points[from];
    const end = points[to];
    if (!start || !end) continue;
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  }
  context.stroke();

  for (const point of points) {
    context.beginPath();
    context.arc(point.x, point.y, 2.5 * unit, 0, 2 * Math.PI);
    context.fill();
  }
}

/**
 * Clears the canvas and draws a subtle skeleton for every detected hand of `frame`
 * (nothing for null). The canvas is assumed to cover the whole camera image.
 */
export function drawLandmarks(
  context: CanvasRenderingContext2D,
  frame: GestureFrame | null,
  options: DrawLandmarksOptions,
): void {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  if (!frame) return;
  drawHand(context, frame.left, options);
  drawHand(context, frame.right, options);
}
