// A deliberately busy, photo-like room that stands in for the webcam in the studio preview:
// a bright window behind the song chips, a colourful bookshelf behind the right-hand
// indicators, string lights, and a singer in a light top under the record bar. Floating
// controls that stay legible over this will stay legible over a real webcam picture.

const WIDTH = 1280;
const HEIGHT = 720;
/** A still canvas produces no frames; redrawing keeps the stream alive for late viewers. */
const REDRAW_INTERVAL_MS = 500;

/** Small seeded generator, so every screenshot shows the same room. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

type Context = CanvasRenderingContext2D;

function drawWall(context: Context): void {
  const wall = context.createLinearGradient(0, 0, WIDTH, 0);
  wall.addColorStop(0, '#6d5a4b');
  wall.addColorStop(0.55, '#a58d76');
  wall.addColorStop(1, '#d9c6ad');
  context.fillStyle = wall;
  context.fillRect(0, 0, WIDTH, HEIGHT);
}

/** On the right of the camera image, so it shows top-left in the mirrored preview. */
function drawWindow(context: Context): void {
  const x = 860;
  const y = 40;
  const width = 360;
  const height = 400;
  const glow = context.createRadialGradient(x + 180, y + 160, 40, x + 180, y + 200, 420);
  glow.addColorStop(0, 'rgb(255 250 235 / 0.65)');
  glow.addColorStop(1, 'rgb(255 250 235 / 0)');
  context.fillStyle = glow;
  context.fillRect(x - 260, 0, width + 400, HEIGHT);

  const sky = context.createLinearGradient(0, y, 0, y + height);
  sky.addColorStop(0, '#f7fbff');
  sky.addColorStop(1, '#dfeaf3');
  context.fillStyle = sky;
  context.fillRect(x, y, width, height);
  // Trees outside.
  context.fillStyle = '#9fb98f';
  for (let index = 0; index < 5; index += 1) {
    context.beginPath();
    context.ellipse(x + 40 + index * 75, y + height - 40, 60, 90, 0, 0, Math.PI * 2);
    context.fill();
  }
  // Blinds and frame.
  context.fillStyle = 'rgb(255 255 255 / 0.55)';
  for (let slat = y; slat < y + 150; slat += 12) context.fillRect(x, slat, width, 6);
  context.fillStyle = '#f2ece4';
  context.fillRect(x - 12, y - 12, width + 24, 12);
  context.fillRect(x - 12, y + height, width + 24, 16);
  context.fillRect(x - 12, y, 12, height);
  context.fillRect(x + width, y, 12, height);
  context.fillRect(x + width / 2 - 5, y, 10, height);
}

/** On the left of the camera image, so it shows behind the right-hand indicators. */
function drawBookshelf(context: Context, random: () => number): void {
  context.fillStyle = '#3b2a1f';
  context.fillRect(20, 60, 300, 640);
  const colours = ['#d94f3d', '#f2c14e', '#3a7ca5', '#f7f7f2', '#2f9c6d', '#8e5bd1', '#111111'];
  for (let shelf = 0; shelf < 5; shelf += 1) {
    const base = 180 + shelf * 125;
    let x = 36;
    while (x < 300) {
      const width = 12 + random() * 18;
      const height = 70 + random() * 35;
      context.fillStyle = colours[Math.floor(random() * colours.length)] ?? '#ffffff';
      context.fillRect(x, base - height, Math.min(width, 304 - x), height);
      x += width + 2;
    }
    context.fillStyle = '#5a4130';
    context.fillRect(20, base, 300, 14);
  }
}

function drawStringLights(context: Context): void {
  for (let index = 0; index < 26; index += 1) {
    const x = 40 + index * 48;
    const y = 30 + Math.sin(index * 0.55) * 14 + (index % 2) * 6;
    const glow = context.createRadialGradient(x, y, 1, x, y, 22);
    glow.addColorStop(0, 'rgb(255 236 170 / 0.95)');
    glow.addColorStop(1, 'rgb(255 214 120 / 0)');
    context.fillStyle = glow;
    context.fillRect(x - 22, y - 22, 44, 44);
    context.fillStyle = '#fff8dc';
    context.beginPath();
    context.arc(x, y, 3.5, 0, Math.PI * 2);
    context.fill();
  }
}

function drawPlant(context: Context, random: () => number): void {
  context.fillStyle = '#c4673e';
  context.fillRect(1090, 580, 120, 140);
  for (let leaf = 0; leaf < 22; leaf += 1) {
    context.fillStyle = leaf % 2 === 0 ? '#3f7d3a' : '#5fa04e';
    context.beginPath();
    context.ellipse(
      1150 + (random() - 0.5) * 180,
      520 + (random() - 0.5) * 140,
      18,
      52,
      (random() - 0.5) * 2.4,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

function drawSinger(context: Context): void {
  const centre = WIDTH / 2;
  // A light hoodie: the worst case for the record bar's white details.
  context.fillStyle = '#e9e6e1';
  context.beginPath();
  context.ellipse(centre, HEIGHT + 60, 300, 260, 0, Math.PI, 0);
  context.fill();
  context.strokeStyle = '#c8c3bb';
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(centre - 40, 500);
  context.lineTo(centre - 30, 640);
  context.moveTo(centre + 40, 500);
  context.lineTo(centre + 30, 640);
  context.stroke();
  // Neck, head, hair.
  context.fillStyle = '#c99a7c';
  context.fillRect(centre - 34, 360, 68, 90);
  context.beginPath();
  context.ellipse(centre, 300, 86, 108, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#2a1d17';
  context.beginPath();
  context.ellipse(centre, 240, 98, 72, 0, Math.PI, 0);
  context.fill();
  context.fillRect(centre - 98, 236, 26, 150);
  context.fillRect(centre + 72, 236, 26, 150);
  // Headphones and a microphone on a stand.
  context.strokeStyle = '#1b1b1f';
  context.lineWidth = 14;
  context.beginPath();
  context.arc(centre, 290, 104, Math.PI * 1.08, Math.PI * 1.92);
  context.stroke();
  context.fillStyle = '#1b1b1f';
  context.fillRect(centre - 118, 280, 26, 56);
  context.fillRect(centre + 92, 280, 26, 56);
  context.fillStyle = '#26262b';
  context.beginPath();
  context.ellipse(centre + 6, 430, 26, 34, -0.2, 0, Math.PI * 2);
  context.fill();
  context.fillRect(centre + 2, 460, 10, 260);
}

function drawGrain(context: Context, random: () => number): void {
  for (let dot = 0; dot < 9000; dot += 1) {
    context.fillStyle = random() > 0.5 ? 'rgb(255 255 255 / 0.05)' : 'rgb(0 0 0 / 0.06)';
    context.fillRect(random() * WIDTH, random() * HEIGHT, 2, 2);
  }
}

function paintRoom(context: Context): void {
  const random = seededRandom(7);
  drawWall(context);
  drawWindow(context);
  drawBookshelf(context, random);
  drawStringLights(context);
  drawPlant(context, random);
  drawSinger(context);
  drawGrain(context, random);
}

let stream: MediaStream | null = null;

/** One shared stream of the busy room, created on first use. Null if canvas is unavailable. */
export function busyBackdropStream(): MediaStream | null {
  if (stream) return stream;
  const room = document.createElement('canvas');
  room.width = WIDTH;
  room.height = HEIGHT;
  const roomContext = room.getContext('2d');
  const output = document.createElement('canvas');
  output.width = WIDTH;
  output.height = HEIGHT;
  const outputContext = output.getContext('2d');
  if (!roomContext || !outputContext) return null;

  paintRoom(roomContext);
  stream = output.captureStream();
  const redraw = () => outputContext.drawImage(room, 0, 0);
  redraw();
  window.setInterval(redraw, REDRAW_INTERVAL_MS);
  return stream;
}
