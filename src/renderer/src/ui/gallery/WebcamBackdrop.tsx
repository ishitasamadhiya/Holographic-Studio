// A stand-in for the live webcam picture: a bright, busy, slightly out-of-focus home studio
// drawn in SVG. It exists to stress-test legibility — a white window, saturated book spines
// and skin tones are exactly what the glass controls have to survive in real use.
import { type ReactNode, useId } from 'react';

const BOOK_COLORS = [
  '#d9483b',
  '#f2b632',
  '#2f7dd1',
  '#2aa876',
  '#f08a5d',
  '#6a4c93',
  '#f7f3ea',
  '#22252b',
  '#e4572e',
  '#17bebb',
  '#ffd9c0',
  '#3d5a80',
];

/** Small deterministic generator (mulberry32) so the "photo" is identical on every render. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function bookRow(seed: number, left: number, right: number, baseline: number): ReactNode[] {
  const random = createRandom(seed);
  const books: ReactNode[] = [];
  let x = left;
  while (x < right - 12) {
    const width = 12 + Math.round(random() * 16);
    const height = 78 + Math.round(random() * 44);
    const color = BOOK_COLORS[Math.floor(random() * BOOK_COLORS.length)] ?? '#ffffff';
    books.push(
      <rect
        key={x}
        x={x}
        y={baseline - height}
        width={width - 2}
        height={height}
        rx="2"
        fill={color}
      />,
    );
    x += width;
  }
  return books;
}

const STRING_LIGHTS = [
  [330, 62],
  [392, 84],
  [452, 96],
  [514, 98],
  [578, 90],
  [640, 76],
  [702, 60],
] as const;

export function WebcamBackdrop({ className }: { className?: string }) {
  const id = useId();
  const ref = (name: string) => `url(#${id}-${name})`;

  return (
    <svg
      className={className}
      viewBox="0 0 1280 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-wall`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#efe4d6" />
          <stop offset="1" stopColor="#cdb8a3" />
        </linearGradient>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#eaf5ff" />
          <stop offset="1" stopColor="#bfe3c4" />
        </linearGradient>
        <radialGradient id={`${id}-bloom`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-skin`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6d2b3" />
          <stop offset="1" stopColor="#d49b76" />
        </linearGradient>
        <linearGradient id={`${id}-sweater`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0b54a" />
          <stop offset="1" stopColor="#d9852f" />
        </linearGradient>
        <linearGradient id={`${id}-art`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9a5a" />
          <stop offset="0.5" stopColor="#ff5d8f" />
          <stop offset="1" stopColor="#7b5cff" />
        </linearGradient>
        <linearGradient id={`${id}-desk`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3dcc0" />
          <stop offset="1" stopColor="#d7b48c" />
        </linearGradient>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2b2d33" />
          <stop offset="0.5" stopColor="#70747e" />
          <stop offset="1" stopColor="#25272c" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
        <filter id={`${id}-softer`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
          <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.55 0" />
        </filter>
      </defs>

      {/* Room, slightly out of focus like a webcam background. */}
      <g filter={ref('soft')}>
        <rect width="1280" height="800" fill={ref('wall')} />

        {/* Window with daylight and garden greens. */}
        <rect x="812" y="36" width="436" height="440" rx="6" fill={ref('sky')} />
        <g filter={ref('softer')}>
          <ellipse cx="900" cy="430" rx="120" ry="70" fill="#7fbf6a" />
          <ellipse cx="1090" cy="440" rx="150" ry="80" fill="#4f9a57" />
          <ellipse cx="1190" cy="380" rx="70" ry="90" fill="#8fd08a" />
        </g>
        <rect
          x="804"
          y="28"
          width="452"
          height="456"
          rx="8"
          fill="none"
          stroke="#fbf7f0"
          strokeWidth="16"
        />
        <path d="M1030 36v440M812 250h436" stroke="#fbf7f0" strokeWidth="10" />

        {/* Bookshelf: lots of small saturated shapes. */}
        <rect x="0" y="48" width="300" height="600" fill="#5b3f2d" />
        {[176, 316, 456, 596].map((baseline, row) => (
          <g key={baseline}>
            <rect x="12" y={baseline - 128} width="276" height="128" fill="#3a271c" />
            {bookRow(11 + row * 17, 18, 284, baseline)}
            <rect x="0" y={baseline} width="300" height="12" fill="#6d4c37" />
          </g>
        ))}

        {/* Framed print. */}
        <rect x="372" y="150" width="196" height="236" rx="4" fill="#fbf7f0" />
        <rect x="388" y="166" width="164" height="204" fill={ref('art')} />
        <circle cx="440" cy="236" r="38" fill="#ffe27a" />
        <circle cx="506" cy="306" r="52" fill="#3ad0c2" fillOpacity="0.85" />

        {/* Desk surface in the foreground. */}
        <rect x="0" y="716" width="1280" height="84" fill={ref('desk')} />

        {/* Plant by the window. */}
        <path d="M1128 716l14-112h84l14 112z" fill="#e8734a" />
        {[-58, -30, -6, 20, 46, 70].map((angle) => (
          <ellipse
            key={angle}
            cx="1184"
            cy="520"
            rx="24"
            ry="96"
            fill={angle % 4 === 0 ? '#2f8f5b' : '#3fae6c'}
            transform={`rotate(${angle} 1184 610)`}
          />
        ))}
      </g>

      {/* Window glare and string lights: the brightest spots in the picture. */}
      <ellipse cx="1030" cy="250" rx="420" ry="360" fill={ref('bloom')} />
      <path
        d="M300 44c110 70 320 78 430 4"
        fill="none"
        stroke="#5a4a3c"
        strokeWidth="2"
        strokeOpacity="0.6"
      />
      {STRING_LIGHTS.map(([x, y]) => (
        <g key={x}>
          <circle cx={x} cy={y} r="22" fill="#ffdf9a" fillOpacity="0.35" />
          <circle cx={x} cy={y} r="8" fill="#fff6d8" />
        </g>
      ))}

      {/* The singer: headphones on, one hand raised. */}
      <g>
        <path d="M352 800c8-150 110-232 288-232s280 82 288 232z" fill={ref('sweater')} />
        <path d="M586 500h108v86c-32 30-76 30-108 0z" fill="#cf9872" />
        <ellipse cx="640" cy="372" rx="112" ry="140" fill={ref('skin')} />
        <path
          d="M524 372c-14-150 62-214 116-214s130 64 116 214c-12-78-52-128-116-128s-104 50-116 128z"
          fill="#2d1e17"
        />
        <path
          d="M520 372a120 132 0 0 1 240 0"
          fill="none"
          stroke="#1d1f24"
          strokeWidth="20"
          strokeLinecap="round"
        />
        <rect x="492" y="340" width="46" height="104" rx="22" fill="#24262c" />
        <rect x="742" y="340" width="46" height="104" rx="22" fill="#24262c" />
        <ellipse cx="600" cy="384" rx="9" ry="6" fill="#3a2a22" />
        <ellipse cx="680" cy="384" rx="9" ry="6" fill="#3a2a22" />
        <path
          d="M612 446q28 18 56 0"
          fill="none"
          stroke="#a4563f"
          strokeWidth="6"
          strokeLinecap="round"
        />

        {/* Raised open hand. */}
        <g transform="translate(948 452) rotate(8)">
          <path d="M-44 150l-6-110h100l-6 110z" fill="#d9a47f" />
          <rect x="-50" y="-10" width="100" height="92" rx="34" fill={ref('skin')} />
          {[
            [-44, -78, -10],
            [-17, -98, -3],
            [10, -94, 4],
            [36, -72, 11],
          ].map(([x, y, angle]) => (
            <rect
              key={x}
              x={x}
              y={y}
              width="22"
              height="104"
              rx="11"
              fill={ref('skin')}
              transform={`rotate(${angle} ${x} 0)`}
            />
          ))}
          <rect
            x="-86"
            y="-8"
            width="24"
            height="76"
            rx="12"
            fill={ref('skin')}
            transform="rotate(-38 -62 60)"
          />
        </g>
      </g>

      {/* Microphone on a stand, in front of the singer. */}
      <path d="M452 800V610" stroke="#1f2126" strokeWidth="12" strokeLinecap="round" />
      <rect x="418" y="478" width="68" height="140" rx="34" fill={ref('metal')} />
      <path d="M422 532h60M422 556h60" stroke="#15161a" strokeWidth="4" />
      <circle
        cx="530"
        cy="520"
        r="74"
        fill="#111216"
        fillOpacity="0.22"
        stroke="#15161a"
        strokeWidth="6"
      />

      {/* Sensor noise. */}
      <rect
        width="1280"
        height="800"
        filter={ref('grain')}
        opacity="0.2"
        style={{ mixBlendMode: 'overlay' }}
      />
    </svg>
  );
}
