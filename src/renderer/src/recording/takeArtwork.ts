// The still picture shown for the whole video of an Audio Only take: the app's dark canvas,
// a soft holographic glow, the wordmark, and what was recorded when.

export interface TakeArtworkInfo {
  /** File name of the backing track, or null for an a cappella take. */
  backingTrackName: string | null;
  date: Date;
}

/** Renders the artwork as PNG bytes. */
export type TakeArtworkRenderer = (info: TakeArtworkInfo) => Promise<ArrayBuffer>;

export const ARTWORK_WIDTH = 1920;
export const ARTWORK_HEIGHT = 1080;

const BACKGROUND = '#08080b';
/** The design system's holographic tints (src/renderer/src/ui/tokens.css). */
const LILAC = '207, 191, 255';
const ICE = '169, 216, 255';
const MINT = '179, 243, 218';
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif';
const MAX_TITLE_LENGTH = 48;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface ArtworkGlow {
  centreX: number;
  centreY: number;
  radius: number;
  /** "r, g, b" */
  rgb: string;
  /** Opacity at the centre; the glow fades to nothing at its radius. */
  opacity: number;
}

export interface ArtworkLine {
  text: string;
  /** Vertical centre of the line. */
  y: number;
  sizePx: number;
  weight: number;
  opacity: number;
  letterSpacingPx: number;
}

export interface TakeArtworkPlan {
  background: string;
  glows: ArtworkGlow[];
  lines: ArtworkLine[];
}

/** "My_Song (Karaoke).mp3" -> "My Song (Karaoke)", shortened to fit on one line. */
export function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[a-z0-9]{1,5}$/i, '');
  const title = withoutExtension.replace(/[_\s]+/g, ' ').trim();
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

/** "October 5, 2026", in local time. */
export function formatArtworkDate(date: Date): string {
  return `${MONTHS[date.getMonth()] ?? ''} ${date.getDate()}, ${date.getFullYear()}`;
}

export function planTakeArtwork(info: TakeArtworkInfo): TakeArtworkPlan {
  const title = info.backingTrackName ? titleFromFileName(info.backingTrackName) : '';
  const lines: ArtworkLine[] = [
    {
      text: 'Holographic Studio',
      y: title ? 468 : 510,
      sizePx: 104,
      weight: 600,
      opacity: 0.96,
      letterSpacingPx: -2.5,
    },
  ];
  if (title) {
    lines.push({ text: title, y: 592, sizePx: 46, weight: 500, opacity: 0.74, letterSpacingPx: 0 });
  }
  lines.push({
    text: formatArtworkDate(info.date),
    y: title ? 664 : 616,
    sizePx: 30,
    weight: 400,
    opacity: 0.56,
    letterSpacingPx: 0.5,
  });

  return {
    background: BACKGROUND,
    // Large, faint and overlapping: a restrained wash of colour, never a neon edge.
    glows: [
      { centreX: 520, centreY: 300, radius: 900, rgb: LILAC, opacity: 0.2 },
      { centreX: 1480, centreY: 420, radius: 860, rgb: ICE, opacity: 0.16 },
      { centreX: 1040, centreY: 980, radius: 780, rgb: MINT, opacity: 0.12 },
    ],
    lines,
  };
}

/** The part of the 2D canvas API the artwork is painted with. */
export type ArtworkContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'fillRect'
  | 'createRadialGradient'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'letterSpacing'
  | 'fillText'
>;

export function paintTakeArtwork(context: ArtworkContext, plan: TakeArtworkPlan): void {
  context.fillStyle = plan.background;
  context.fillRect(0, 0, ARTWORK_WIDTH, ARTWORK_HEIGHT);

  for (const glow of plan.glows) {
    const gradient = context.createRadialGradient(
      glow.centreX,
      glow.centreY,
      0,
      glow.centreX,
      glow.centreY,
      glow.radius,
    );
    gradient.addColorStop(0, `rgba(${glow.rgb}, ${glow.opacity})`);
    gradient.addColorStop(0.55, `rgba(${glow.rgb}, ${glow.opacity * 0.35})`);
    gradient.addColorStop(1, `rgba(${glow.rgb}, 0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, ARTWORK_WIDTH, ARTWORK_HEIGHT);
  }

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const line of plan.lines) {
    context.font = `${line.weight} ${line.sizePx}px ${FONT_FAMILY}`;
    context.letterSpacing = `${line.letterSpacingPx}px`;
    context.fillStyle = `rgba(255, 255, 255, ${line.opacity})`;
    context.fillText(line.text, ARTWORK_WIDTH / 2, line.y);
  }
}

/** Paints the artwork on an off-screen canvas and encodes it as PNG. */
export const renderTakeArtwork: TakeArtworkRenderer = async (info) => {
  const canvas = document.createElement('canvas');
  canvas.width = ARTWORK_WIDTH;
  canvas.height = ARTWORK_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The artwork canvas is not available');
  paintTakeArtwork(context, planTakeArtwork(info));

  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The artwork could not be encoded'));
    }, 'image/png');
  });
  return png.arrayBuffer();
};
