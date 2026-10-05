import { type ButtonHTMLAttributes, type ReactNode, type Ref, useContext } from 'react';
import { cx } from './internal/classNames';
import { InsideTooltipContext } from './internal/tooltipContext';
import styles from './IconButton.module.css';

export type IconButtonVariant = 'glass' | 'ghost' | 'solid';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /** Accessible name, also shown as the native tooltip (unless wrapped in a Tooltip). */
  label: string;
  /** The icon. */
  children: ReactNode;
  /** `glass` floats on the video, `ghost` sits on a panel, `solid` is the white emphasis. */
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** For toggle-style buttons: reflected as aria-pressed and a highlighted look. */
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  children,
  variant = 'glass',
  size = 'md',
  pressed,
  type = 'button',
  title,
  className,
  ref,
  ...rest
}: IconButtonProps) {
  const isInsideTooltip = useContext(InsideTooltipContext);
  return (
    <button
      ref={ref}
      type={type}
      className={cx(styles.button, styles[variant], styles[size], className)}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? (isInsideTooltip ? undefined : label)}
      {...rest}
    >
      {children}
    </button>
  );
}
