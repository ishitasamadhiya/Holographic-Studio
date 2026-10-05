import type { CSSProperties, HTMLAttributes, KeyboardEvent, ReactNode, Ref } from 'react';
import { useFieldControlProps } from './Field';
import { cx } from './internal/classNames';
import { edgeEnabledIndex, nextEnabledIndex } from './rovingIndex';
import styles from './SegmentedControl.module.css';

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export type SegmentedControlSize = 'sm' | 'md';

export interface SegmentedControlProps<Value extends string> extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'onChange' | 'children' | 'role' | 'onKeyDown'
> {
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /** Accessible name of the group. May be omitted inside a Field / FormRow. */
  label?: string;
  size?: SegmentedControlSize;
  /** Stretches to the container width; segments are always equally wide. */
  fullWidth?: boolean;
  disabled?: boolean;
  ref?: Ref<HTMLDivElement>;
}

/** A small set of mutually exclusive choices (Gesture | Manual, Video | Audio Only). */
export function SegmentedControl<Value extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  fullWidth = false,
  disabled = false,
  className,
  style,
  ref,
  ...rest
}: SegmentedControlProps<Value>) {
  const field = useFieldControlProps({ ...rest, 'aria-label': label ?? rest['aria-label'] });
  const selectedIndex = options.findIndex((option) => option.value === value);
  const disabledFlags = options.map((option) => disabled || option.disabled === true);

  const selectIndex = (index: number) => {
    const option = options[index];
    if (option && index !== selectedIndex) onChange(option.value);
  };

  // Radio-group keyboard model: arrows move the selection, Home/End jump to the ends, and
  // focus follows the selection.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = Math.max(selectedIndex, 0);
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = nextEnabledIndex(from, 1, disabledFlags);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        target = nextEnabledIndex(from, -1, disabledFlags);
        break;
      case 'Home':
        target = edgeEnabledIndex(1, disabledFlags);
        break;
      case 'End':
        target = edgeEnabledIndex(-1, disabledFlags);
        break;
      default:
        return;
    }
    event.preventDefault();
    selectIndex(target);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[target]?.focus();
  };

  const cssVariables = {
    '--segment-count': options.length,
    '--segment-index': Math.max(selectedIndex, 0),
  } as CSSProperties;

  return (
    <div
      {...rest}
      {...field}
      ref={ref}
      role="radiogroup"
      aria-disabled={disabled || undefined}
      className={cx(styles.group, styles[size], fullWidth && styles.fullWidth, className)}
      style={{ ...cssVariables, ...style }}
      onKeyDown={handleKeyDown}
    >
      {selectedIndex >= 0 && <span className={styles.thumb} aria-hidden="true" />}
      {options.map((option, index) => {
        const isSelected = index === selectedIndex;
        const isDisabled = disabledFlags[index] === true;
        // One tab stop for the whole group: the selected option, or the first when none is.
        const isTabStop = isSelected || (selectedIndex < 0 && index === 0);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={isDisabled}
            tabIndex={isTabStop && !isDisabled ? 0 : -1}
            className={styles.segment}
            onClick={() => selectIndex(index)}
          >
            {option.icon && <span className={styles.icon}>{option.icon}</span>}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
