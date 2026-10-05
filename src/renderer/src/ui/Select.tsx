import type { ChangeEvent, ReactNode, Ref, SelectHTMLAttributes } from 'react';
import { useFieldControlProps } from './Field';
import { ChevronDownIcon } from './icons';
import { cx } from './internal/classNames';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'onChange' | 'value' | 'defaultValue' | 'children' | 'multiple' | 'size'
> {
  options: readonly SelectOption[];
  /** The selected option's value, or null when nothing is chosen yet. */
  value: string | null;
  onChange: (value: string) => void;
  /** Accessible name. May be omitted inside a Field / FormRow. */
  label?: string;
  /** Shown while `value` is null or no longer matches an option. */
  placeholder?: string;
  /** Shown instead of the list when there are no options (e.g. no devices found). */
  emptyLabel?: string;
  /** Small icon at the start of the control. */
  icon?: ReactNode;
  /** The native <select>, which also receives every attribute except className and style. */
  ref?: Ref<HTMLSelectElement>;
}

const PLACEHOLDER_VALUE = '';

/**
 * A styled native <select>: the closed control matches the design system, the open list is
 * the operating system's own menu, which is what people expect for device pickers.
 */
export function Select({
  options,
  value,
  onChange,
  label,
  placeholder = 'Choose…',
  emptyLabel = 'Nothing available',
  icon,
  disabled = false,
  className,
  style,
  ref,
  ...rest
}: SelectProps) {
  const field = useFieldControlProps({ ...rest, 'aria-label': label ?? rest['aria-label'] });
  const isEmpty = options.length === 0;
  const hasSelection = value !== null && options.some((option) => option.value === value);

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (event.target.value !== PLACEHOLDER_VALUE) onChange(event.target.value);
  };

  return (
    <div
      className={cx(styles.root, icon !== undefined && styles.withIcon, className)}
      style={style}
      data-placeholder={!hasSelection || undefined}
    >
      {icon && <span className={styles.icon}>{icon}</span>}
      <select
        {...rest}
        {...field}
        ref={ref}
        className={styles.select}
        value={hasSelection ? (value ?? PLACEHOLDER_VALUE) : PLACEHOLDER_VALUE}
        disabled={disabled || isEmpty}
        onChange={handleChange}
      >
        {!hasSelection && (
          <option value={PLACEHOLDER_VALUE} disabled hidden>
            {isEmpty ? emptyLabel : placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={14} className={styles.chevron} />
    </div>
  );
}
