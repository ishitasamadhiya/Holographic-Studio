import { type SVGAttributes, useId } from 'react';

export interface AppMarkProps extends Omit<SVGAttributes<SVGSVGElement>, 'children'> {
  /** Width and height in CSS pixels. */
  size?: number;
  /** Accessible name. Without it the mark is decorative. */
  title?: string;
}

/**
 * The Holographic Studio mark: a sound wave inside an iridescent ring. One of the few places
 * the accent gradient is used at full strength.
 */
export function AppMark({ size = 32, title, ...rest }: AppMarkProps) {
  const gradientId = useId();

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="3"
          y1="4"
          x2="29"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="var(--holo-lilac)" />
          <stop offset="0.52" stopColor="var(--holo-ice)" />
          <stop offset="1" stopColor="var(--holo-mint)" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="13.5" stroke={`url(#${gradientId})`} strokeWidth="2" />
      <path
        d="M10 14.25v3.5M13 11.5v9M16 8.75v14.5M19 11.5v9M22 14.25v3.5"
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
