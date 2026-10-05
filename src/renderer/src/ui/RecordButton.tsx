import type { ButtonHTMLAttributes, Ref } from 'react';
import { cx } from './internal/classNames';
import styles from './RecordButton.module.css';

export type RecordButtonState = 'idle' | 'countdown' | 'recording' | 'paused';
export type RecordButtonSize = 'md' | 'lg';

export interface RecordButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  state: RecordButtonState;
  /** Seconds left, shown inside the ring while `state` is 'countdown'. */
  countdownValue?: number;
  size?: RecordButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

const DEFAULT_LABELS: Record<RecordButtonState, string> = {
  idle: 'Start recording',
  countdown: 'Cancel countdown',
  recording: 'Stop recording',
  paused: 'Stop recording',
};

/**
 * The one large control of the studio screen. Idle shows a red disc, recording and paused
 * show the stop square (pausing and resuming belong to a separate button, as in a camera app),
 * and the countdown shows the remaining seconds.
 */
export function RecordButton({
  state,
  countdownValue,
  size = 'lg',
  type = 'button',
  className,
  ref,
  'aria-label': ariaLabel,
  ...rest
}: RecordButtonProps) {
  const showsCountdown = state === 'countdown' && countdownValue !== undefined;

  return (
    <button
      ref={ref}
      type={type}
      className={cx(styles.button, styles[size], className)}
      data-state={state}
      aria-label={ariaLabel ?? DEFAULT_LABELS[state]}
      {...rest}
    >
      <span className={styles.ring} aria-hidden="true" />
      <span className={styles.core} aria-hidden="true" />
      {showsCountdown && (
        // Keyed by the number so each tick replays the entrance animation.
        <span key={countdownValue} className={styles.count} aria-live="assertive">
          {countdownValue}
        </span>
      )}
    </button>
  );
}
