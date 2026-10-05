import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { cx } from './internal/classNames';
import { Spinner } from './Spinner';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon shown before the label. Replaced by a spinner while loading. */
  iconStart?: ReactNode;
  /** Icon shown after the label. */
  iconEnd?: ReactNode;
  /** Shows a spinner and ignores presses, but stays focusable so focus is not lost. */
  loading?: boolean;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  iconStart,
  iconEnd,
  loading = false,
  fullWidth = false,
  type = 'button',
  className,
  children,
  onClick,
  ref,
  ...rest
}: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        loading && styles.loading,
        className,
      )}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading ? (
        // Drawn in the label colour: the accent arc is invisible on the white primary button.
        <Spinner size="sm" tone="current" label={null} className={styles.icon} />
      ) : (
        iconStart && <span className={styles.icon}>{iconStart}</span>
      )}
      <span className={styles.label}>{children}</span>
      {iconEnd && <span className={styles.icon}>{iconEnd}</span>}
    </button>
  );
}
