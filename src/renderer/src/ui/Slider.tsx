import {
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useRef,
} from 'react';
import { useFieldControlProps } from './Field';
import { cx } from './internal/classNames';
import { formatPercent } from './internal/numberFormat';
import {
  sanitizeValue,
  type SliderRange,
  snapToDetent,
  valueAfterKey,
  valueFromPointer,
  valueToFraction,
} from './sliderMath';
import styles from './Slider.module.css';

/** The pointer and key handlers the slider needs for itself. */
type SliderOwnHandlers =
  | 'onPointerDown'
  | 'onPointerMove'
  | 'onPointerUp'
  | 'onPointerCancel'
  | 'onLostPointerCapture'
  | 'onKeyDown';

export interface SliderProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'onChange' | 'children' | 'role' | SliderOwnHandlers
> {
  value: number;
  /** Called continuously while dragging and on every key press. */
  onChange: (value: number) => void;
  /** Called once when a drag ends or a key changes the value: the moment to persist. */
  onChangeEnd?: (value: number) => void;
  /** Visible label and accessible name. May be omitted inside a Field / FormRow. */
  label?: string;
  /** Keeps the label for screen readers only. */
  hideLabel?: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Shift+arrow / Page Up / Page Down distance. Defaults to a tenth of the range. */
  largeStep?: number;
  /** Draws a tick at this value (e.g. unity gain) and makes drags settle on it. */
  unityValue?: number;
  /** Text for the readout and for screen readers. Defaults to a percentage of the range. */
  formatValue?: (value: number) => string;
  showValue?: boolean;
  /** Small icon in front of the label. */
  icon?: ReactNode;
  disabled?: boolean;
  /** The focusable `role="slider"` element, which also receives every other attribute. */
  ref?: Ref<HTMLDivElement>;
}

export function Slider({
  value,
  onChange,
  onChangeEnd,
  label,
  hideLabel = false,
  min = 0,
  max = 1,
  step = 0.01,
  largeStep,
  unityValue,
  formatValue,
  showValue = true,
  icon,
  disabled = false,
  className,
  style,
  ref,
  ...rest
}: SliderProps) {
  const field = useFieldControlProps({ ...rest, 'aria-label': label ?? rest['aria-label'] });
  const railRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const range: SliderRange = { min, max, step };
  // Everything shown, announced and stepped from uses this, never the raw prop.
  const current = sanitizeValue(value, range);
  const latestValue = useRef(current);
  const fraction = valueToFraction(current, range);
  const valueText = formatValue ? formatValue(current) : formatPercent(fraction);
  const showsHeader = label !== undefined && !hideLabel;

  // Several pointer events can arrive between two renders, so drags compare against a ref
  // rather than the (possibly stale) `value` prop.
  const commitDragValue = (next: number) => {
    if (next === latestValue.current) return;
    latestValue.current = next;
    onChange(next);
  };

  const valueAtPointer = (clientX: number): number => {
    const rail = railRef.current;
    if (!rail) return current;
    const rect = rail.getBoundingClientRect();
    const raw = valueFromPointer(clientX, rect.left, rect.width, range);
    return unityValue === undefined ? raw : snapToDetent(raw, unityValue, range);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    isDragging.current = true;
    latestValue.current = current;
    commitDragValue(valueAtPointer(event.clientX));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isDragging.current) commitDragValue(valueAtPointer(event.clientX));
  };

  const endDrag = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    onChangeEnd?.(latestValue.current);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = valueAfterKey(
      event.key,
      event.shiftKey,
      current,
      range,
      largeStep ?? (max - min) / 10,
    );
    if (next === null) return;
    event.preventDefault();
    if (next === current) return;
    onChange(next);
    onChangeEnd?.(next);
  };

  const cssVariables = {
    '--slider-fraction': fraction,
    '--slider-unity': unityValue === undefined ? undefined : valueToFraction(unityValue, range),
  } as CSSProperties;

  return (
    <div
      className={cx(styles.root, !showsHeader && styles.inline, className)}
      data-disabled={disabled || undefined}
      style={{ ...cssVariables, ...style }}
    >
      {showsHeader && (
        <div className={styles.header}>
          <span className={styles.label}>
            {icon && <span className={styles.icon}>{icon}</span>}
            {label}
          </span>
          {showValue && <span className={styles.value}>{valueText}</span>}
        </div>
      )}
      <div
        {...rest}
        {...field}
        ref={ref}
        className={styles.control}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-orientation="horizontal"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={current}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.track}>
          <div className={styles.fill} />
          <div ref={railRef} className={styles.rail} data-slider-rail="">
            {unityValue !== undefined && <div className={styles.tick} />}
            <div className={styles.thumb} />
          </div>
        </div>
      </div>
      {!showsHeader && showValue && <span className={styles.value}>{valueText}</span>}
    </div>
  );
}
