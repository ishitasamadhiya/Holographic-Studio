import {
  type CSSProperties,
  type HTMLAttributes,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { cx } from './internal/classNames';
import { createLatestValueThrottle } from './internal/latestValueThrottle';
import { toUnitInterval } from './internal/numberFormat';
import { PeakHold } from './peakHold';
import styles from './LevelMeter.module.css';

export interface LevelMeterHandle {
  /**
   * Shows `level` (0..1, see meterScale.ts for converting from decibels). Writes straight to
   * the DOM, so it is safe to call on every animation frame without re-rendering React.
   */
  setLevel(level: number): void;
  /** Clears the level and the held peak, e.g. when the input stops. */
  reset(): void;
}

export type LevelMeterOrientation = 'horizontal' | 'vertical';
export type LevelMeterSize = 'sm' | 'md';

export interface LevelMeterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role'> {
  ref?: Ref<LevelMeterHandle>;
  /** Accessible name, e.g. "Microphone level". */
  label: string;
  orientation?: LevelMeterOrientation;
  size?: LevelMeterSize;
  /** How long the peak marker stays before falling back. */
  peakHoldMs?: number;
}

/** Above this the peak marker turns to the warning colour: the input is close to clipping. */
const HOT_LEVEL = 0.92;
const PEAK_DECAY_PER_SECOND = 0.7;
/** Screen readers get a coarse, slow value; announcing 60 changes a second would be noise. */
const ARIA_UPDATE_INTERVAL_MS = 250;

export function LevelMeter({
  ref,
  label,
  orientation = 'horizontal',
  size = 'md',
  peakHoldMs = 1200,
  className,
  style,
  ...rest
}: LevelMeterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const peakHold = useMemo(
    () => new PeakHold({ holdMs: peakHoldMs, decayPerSecond: PEAK_DECAY_PER_SECOND }),
    [peakHoldMs],
  );

  // It lags the picture by up to one interval but always ends on the level actually shown.
  const ariaUpdates = useMemo(
    () =>
      createLatestValueThrottle<number>(ARIA_UPDATE_INTERVAL_MS, (level) => {
        rootRef.current?.setAttribute('aria-valuenow', String(Math.round(level * 100)));
      }),
    [],
  );
  useEffect(() => () => ariaUpdates.cancel(), [ariaUpdates]);

  useImperativeHandle(ref, () => {
    const show = (level: number, peak: number) => {
      const root = rootRef.current;
      if (!root) return;
      root.style.setProperty('--meter-level', level.toFixed(3));
      root.style.setProperty('--meter-peak', peak.toFixed(3));
      root.toggleAttribute('data-hot', peak >= HOT_LEVEL);
      root.toggleAttribute('data-active', peak > 0.004);
    };

    return {
      setLevel(level) {
        const shown = toUnitInterval(level);
        show(shown, peakHold.update(shown, performance.now()));
        ariaUpdates.push(shown);
      },
      reset() {
        peakHold.reset();
        show(0, 0);
        ariaUpdates.flush(0);
      },
    };
  }, [peakHold, ariaUpdates]);

  const initialVariables = { '--meter-level': 0, '--meter-peak': 0 } as CSSProperties;

  return (
    <div
      {...rest}
      ref={rootRef}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      className={cx(styles.meter, styles[orientation], styles[size], className)}
      style={{ ...initialVariables, ...style }}
    >
      <div className={styles.fill} />
      <div className={styles.peak} />
    </div>
  );
}
