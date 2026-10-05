import type { CSSProperties, HTMLAttributes } from 'react';
import { cx } from './internal/classNames';
import { formatPercent, toUnitInterval } from './internal/numberFormat';
import styles from './ProgressBar.module.css';

export type ProgressBarSize = 'sm' | 'md';

export interface ProgressBarProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'role'
> {
  /** 0..1, or undefined while the amount of work is unknown. */
  value?: number;
  /** Accessible name; also shown above the bar unless `hideLabel` is set. */
  label: string;
  hideLabel?: boolean;
  /** Shows the percentage next to the label. Ignored while indeterminate. */
  showValue?: boolean;
  size?: ProgressBarSize;
}

export function ProgressBar({
  value,
  label,
  hideLabel = false,
  showValue = false,
  size = 'md',
  className,
  style,
  ...rest
}: ProgressBarProps) {
  const isIndeterminate = value === undefined;
  const fraction = isIndeterminate ? 0 : toUnitInterval(value);
  const showsHeader = !hideLabel || (showValue && !isIndeterminate);

  return (
    <div className={cx(styles.root, className)} style={style}>
      {showsHeader && (
        <div className={styles.header} aria-hidden="true">
          {!hideLabel && <span className={styles.label}>{label}</span>}
          {showValue && !isIndeterminate && (
            <span className={styles.value}>{formatPercent(fraction)}</span>
          )}
        </div>
      )}
      <div
        {...rest}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={isIndeterminate ? undefined : Math.round(fraction * 100)}
        className={cx(styles.track, styles[size], isIndeterminate && styles.indeterminate)}
        style={{ '--progress': fraction } as CSSProperties}
      >
        <div className={styles.fill} />
      </div>
    </div>
  );
}
