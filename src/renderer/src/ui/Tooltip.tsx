import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './internal/classNames';
import { InsideTooltipContext } from './internal/tooltipContext';
import styles from './Tooltip.module.css';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Short text. It must repeat information the child already exposes (e.g. its aria-label). */
  label: string;
  placement?: TooltipPlacement;
  /** The control the hint belongs to. */
  children: ReactNode;
}

/**
 * A CSS-only hint bubble shown on hover and keyboard focus. It is purely visual (hidden from
 * assistive technology), so the wrapped control must carry its own accessible name.
 */
export function Tooltip({ label, placement = 'top', children, className, ...rest }: TooltipProps) {
  return (
    <span {...rest} className={cx(styles.anchor, className)}>
      <InsideTooltipContext.Provider value={true}>{children}</InsideTooltipContext.Provider>
      <span className={cx(styles.bubble, styles[placement])} aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
