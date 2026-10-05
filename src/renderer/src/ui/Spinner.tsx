import type { HTMLAttributes } from 'react';
import { cx } from './internal/classNames';
import styles from './Spinner.module.css';

export type SpinnerSize = 'sm' | 'md' | 'lg';
/** `accent` is the iridescent arc for dark surfaces; `current` follows the text colour. */
export type SpinnerTone = 'accent' | 'current';

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  size?: SpinnerSize;
  /** Use `current` wherever the pale accent would vanish, e.g. on the white primary button. */
  tone?: SpinnerTone;
  /** Announced to screen readers. Pass null when nearby text already says what is loading. */
  label?: string | null;
}

/** Indeterminate activity indicator: a thin ring with a fading arc. */
export function Spinner({
  size = 'md',
  tone = 'accent',
  label = 'Loading',
  className,
  ...rest
}: SpinnerProps) {
  return (
    <span
      {...rest}
      className={cx(styles.spinner, styles[size], styles[tone], className)}
      role={label ? 'status' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    />
  );
}
