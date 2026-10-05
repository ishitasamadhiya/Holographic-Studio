// A drawn picture that stands in for the camera in the developer preview, so the mirrored
// preview has something to show without opening a real device.

const WIDTH = 640;
const HEIGHT = 360;
/** A still canvas produces no frames; redrawing keeps the stream alive for late viewers. */
const REDRAW_INTERVAL_MS = 500;

function drawScene(context: CanvasRenderingContext2D): void {
  const wall = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  wall.addColorStop(0, '#2b2a3d');
  wall.addColorStop(0.55, '#3a3550');
  wall.addColorStop(1, '#1d2433');
  context.fillStyle = wall;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  // A window on one side only, so it is plain to see that the picture is mirrored.
  context.fillStyle = 'rgb(255 236 200 / 0.5)';
  context.fillRect(48, 44, 108, 150);

  // Head, shoulders and two raised hands.
  context.fillStyle = '#c9b8ad';
  context.beginPath();
  context.arc(WIDTH / 2, 150, 54, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#5b6b8c';
  context.beginPath();
  context.ellipse(WIDTH / 2, HEIGHT + 30, 170, 150, 0, Math.PI, 0);
  context.fill();
  context.fillStyle = '#c9b8ad';
  for (const x of [WIDTH / 2 - 190, WIDTH / 2 + 190]) {
    context.beginPath();
    context.ellipse(x, 210, 26, 34, 0, 0, Math.PI * 2);
    context.fill();
  }
}

let stream: MediaStream | null = null;

/** One shared stream of the stand-in picture, created on first use. */
export function standInCameraStream(): MediaStream | null {
  if (stream) return stream;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return null;

  stream = canvas.captureStream();
  drawScene(context);
  window.setInterval(() => drawScene(context), REDRAW_INTERVAL_MS);
  return stream;
}
