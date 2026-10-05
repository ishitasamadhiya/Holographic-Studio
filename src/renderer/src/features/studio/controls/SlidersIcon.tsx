import type { IconProps } from '@renderer/ui';

/** Three sliders, for the Controls button. Drawn to the design system's icon conventions. */
export function SlidersIcon({ size = 20, title, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      <path d="M4 7h9M17.5 7H20M4 12h2.5M11 12h9M4 17h10M18.5 17H20" />
      <circle cx="15.25" cy="7" r="2.25" />
      <circle cx="8.75" cy="12" r="2.25" />
      <circle cx="16.25" cy="17" r="2.25" />
    </svg>
  );
}
