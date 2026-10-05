import type { ButtonHTMLAttributes, Ref } from 'react';
import { useFieldControlProps } from './Field';
import { cx } from './internal/classNames';
import styles from './Toggle.module.css';

export interface ToggleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'onClick' | 'children' | 'role' | 'type'
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name. May be omitted inside a Field / FormRow. */
  label?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** An on/off switch. Space and Enter toggle it. */
export function Toggle({ checked, onChange, label, className, ref, ...rest }: ToggleProps) {
  const field = useFieldControlProps({ ...rest, 'aria-label': label ?? rest['aria-label'] });

  return (
    <button
      {...rest}
      {...field}
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx(styles.toggle, className)}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.thumb} aria-hidden="true" />
    </button>
  );
}
