import { type HTMLAttributes, type ReactNode, useId } from 'react';
import { cx } from './internal/classNames';
import { toUnitInterval } from './internal/numberFormat';
import styles from './ProgressRing.module.css';

export interface ProgressRingProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'role'> {
  /** 0..1, or undefined while the amount of work is unknown (spins instead). */
  value?: number;
  /** Accessible name, e.g. "Analyzing reference vocal". Pass null when purely decorative. */
  label: string | null;
  /** Outer diameter in CSS pixels. */
  size?: number;
  strokeWidth?: number;
  /** Centred content, e.g. a percentage or an icon. */
  children?: ReactNode;
}

export function ProgressRing({
  value,
  label,
  size = 40,
  strokeWidth = 3,
  children,
  className,
  style,
  ...rest
}: ProgressRingProps) {
  const gradientId = useId();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const isIndeterminate = value === undefined;
  // An unknown amount shows a fixed quarter arc that rotates.
  const fraction = isIndeterminate ? 0.25 : toUnitInterval(value);

  return (
    <span
      {...rest}
      className={cx(styles.ring, isIndeterminate && styles.indeterminate, className)}
      style={{ width: size, height: size, ...style }}
      role={label === null ? undefined : 'progressbar'}
      aria-label={label ?? undefined}
      aria-hidden={label === null ? true : undefined}
      aria-valuemin={label === null ? undefined : 0}
      aria-valuemax={label === null ? undefined : 100}
      aria-valuenow={label === null || isIndeterminate ? undefined : Math.round(fraction * 100)}
    >
      <svg className={styles.svg} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--holo-lilac)" />
            <stop offset="52%" stopColor="var(--holo-ice)" />
            <stop offset="100%" stopColor="var(--holo-mint)" />
          </linearGradient>
        </defs>
        <circle
          className={styles.track}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <circle
          className={styles.arc}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          stroke={`url(#${gradientId})`}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      {children !== undefined && <span className={styles.content}>{children}</span>}
    </span>
  );
}
