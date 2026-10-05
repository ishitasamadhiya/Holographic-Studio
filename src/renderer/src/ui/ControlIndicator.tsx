import {
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { cx } from './internal/classNames';
import { createLatestValueThrottle } from './internal/latestValueThrottle';
import { formatPercent, toUnitInterval } from './internal/numberFormat';
import styles from './ControlIndicator.module.css';

/**
 * Where the control's value is coming from right now:
 * - `gesture-live`  a tracked hand is driving it
 * - `holding`       the hand just disappeared; the last value is being held
 * - `returning`     the value is easing back to the manual setting
 * - `lost`          gesture control is on but no hand is visible; the manual setting applies
 * - `manual`        the control is set to manual (slider / keyboard)
 */
export type ControlIndicatorStatus = 'gesture-live' | 'holding' | 'returning' | 'lost' | 'manual';

export type ControlIndicatorSize = 'sm' | 'md';

export interface ControlIndicatorHandle {
  /**
   * Shows `value` (0..1). Writes straight to the DOM, so it is safe to call on every
   * animation frame without re-rendering React.
   */
  setValue(value: number): void;
}

export interface ControlIndicatorProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'role'
> {
  ref?: Ref<ControlIndicatorHandle>;
  /** Control name, e.g. "Autotune". About nine characters fit; longer names are ellipsized. */
  label: string;
  status: ControlIndicatorStatus;
  /** Declarative value (0..1). Live updates should use the ref's setValue instead. */
  value?: number;
  icon?: ReactNode;
  /** Draws a small notch at this value (e.g. unity gain for volume). */
  unityValue?: number;
  /**
   * Text for the readout. Defaults to a whole percentage. Texts longer than five characters
   * (a dB value such as "-12.0 dB") are set smaller; up to eight characters fit.
   */
  formatValue?: (value: number) => string;
  /** Overrides the short status caption ("Live", "Hold", …). */
  statusLabel?: string;
  /** `sm` drops the status caption and shortens the track for tight layouts. */
  size?: ControlIndicatorSize;
}

const STATUS_LABELS: Record<ControlIndicatorStatus, string> = {
  'gesture-live': 'Live',
  holding: 'Hold',
  returning: 'Easing',
  lost: 'No hand',
  manual: 'Manual',
};

/** Screen readers get at most one update per interval; the visual readout changes every frame. */
const ARIA_UPDATE_INTERVAL_MS = 400;

/** Readouts longer than this ("100%" is four characters) step down a type size. */
const SHORT_READOUT_MAX_CHARS = 5;

/**
 * Whether a formatter produces long readouts. Decided once per formatter from texts across
 * the range rather than per value, so the type size never jumps while the value moves.
 */
function hasLongReadouts(formatValue: (value: number) => string): boolean {
  return [0, 0.5, 1].some((value) => formatValue(value).length > SHORT_READOUT_MAX_CHARS);
}

/**
 * The live readout for one vocal control, placed at the edge of the video: a slim glass pill
 * with a vertical accent track, the value, the control's name and where the value comes from.
 */
export function ControlIndicator({
  ref,
  label,
  status,
  value = 0,
  icon,
  unityValue,
  formatValue = formatPercent,
  statusLabel = STATUS_LABELS[status],
  size = 'md',
  className,
  style,
  ...rest
}: ControlIndicatorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);

  // What assistive technology is told. It lags the picture by up to one interval but always
  // ends on the value that is actually shown.
  const ariaUpdates = useMemo(
    () =>
      createLatestValueThrottle<number>(ARIA_UPDATE_INTERVAL_MS, (shown) => {
        const root = rootRef.current;
        if (!root) return;
        root.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
        root.setAttribute('aria-valuetext', `${formatValue(shown)}, ${statusLabel}`);
      }),
    [formatValue, statusLabel],
  );
  useEffect(() => () => ariaUpdates.cancel(), [ariaUpdates]);

  // The single write path shared by the `value` prop and the imperative handle. React never
  // renders the readout text itself, so the two cannot overwrite each other.
  const show = useCallback(
    (next: number, announceNow: boolean) => {
      const root = rootRef.current;
      const readout = readoutRef.current;
      if (!root || !readout) return;
      const shown = toUnitInterval(next);
      const text = formatValue(shown);
      root.style.setProperty('--indicator-value', shown.toFixed(3));
      if (readout.textContent !== text) readout.textContent = text;

      if (announceNow) ariaUpdates.flush(shown);
      else ariaUpdates.push(shown);
    },
    [formatValue, ariaUpdates],
  );

  // The value on screen can come from the prop or from setValue. When only the status or the
  // formatter changes, the latest of the two is re-shown; a changed prop always wins.
  const latestValue = useRef(value);
  const lastPropValue = useRef(value);

  useImperativeHandle(
    ref,
    () => ({
      setValue(next) {
        latestValue.current = next;
        show(next, false);
      },
    }),
    [show],
  );

  useLayoutEffect(() => {
    if (lastPropValue.current !== value) {
      lastPropValue.current = value;
      latestValue.current = value;
    }
    show(latestValue.current, true);
  }, [value, show]);

  const cssVariables = {
    '--indicator-unity': unityValue === undefined ? undefined : toUnitInterval(unityValue),
  } as CSSProperties;

  return (
    <div
      {...rest}
      ref={rootRef}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx(styles.indicator, styles[size], className)}
      style={{ ...cssVariables, ...style }}
      data-status={status}
    >
      <span
        ref={readoutRef}
        className={cx(styles.readout, hasLongReadouts(formatValue) && styles.longReadout)}
      />
      <div className={styles.track} aria-hidden="true">
        <div className={styles.fill} />
        {unityValue !== undefined && <div className={styles.unity} />}
        <div className={styles.bead} />
      </div>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      <span className={styles.status} aria-hidden="true">
        <span className={styles.statusDot} />
        {size === 'md' && statusLabel}
      </span>
    </div>
  );
}
