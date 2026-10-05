import type { HTMLAttributes, ReactNode } from 'react';
import { CheckIcon, InfoIcon, WarningIcon } from './icons';
import { cx } from './internal/classNames';
import { ProgressRing } from './ProgressRing';
import { Spinner } from './Spinner';
import styles from './Chip.module.css';

export type ChipTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'recording';
export type ChipSize = 'sm' | 'md';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Colours the leading icon or dot only; the text always stays white for legibility. */
  tone?: ChipTone;
  size?: ChipSize;
  /** Leading icon. */
  icon?: ReactNode;
  /** Shows a small coloured dot instead of an icon (e.g. the recording indicator). */
  dot?: boolean;
  children: ReactNode;
}

/** A small glass capsule for one short fact: the song key, the mode, a device name. */
export function Chip({
  tone = 'neutral',
  size = 'md',
  icon,
  dot = false,
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <span className={cx(styles.chip, styles[size], className)} data-tone={tone} {...rest}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {!dot && icon && <span className={styles.icon}>{icon}</span>}
      <span className={styles.text}>{children}</span>
    </span>
  );
}

export type StatusChipState = 'ready' | 'busy' | 'info' | 'warning' | 'error';

export interface StatusChipProps extends Omit<ChipProps, 'tone' | 'icon' | 'dot'> {
  state: StatusChipState;
  /** With `state="busy"`: 0..1 shows a progress ring instead of the spinner. */
  progress?: number;
  /** Replaces the state's default icon. */
  icon?: ReactNode;
}

const STATE_TONES: Record<StatusChipState, ChipTone> = {
  ready: 'success',
  busy: 'accent',
  info: 'neutral',
  warning: 'warning',
  error: 'danger',
};

function stateIcon(state: StatusChipState, progress: number | undefined): ReactNode {
  switch (state) {
    case 'ready':
      return <CheckIcon strokeWidth={2.25} />;
    case 'busy':
      return progress === undefined ? (
        <Spinner size="sm" label={null} />
      ) : (
        <ProgressRing value={progress} size={14} strokeWidth={2} label={null} />
      );
    case 'info':
      return <InfoIcon />;
    case 'warning':
    case 'error':
      return <WarningIcon />;
  }
}

/**
 * A chip that reports the state of a background job ("Analyzing reference vocal…",
 * "Reference melody ready"). Changes are announced politely to screen readers.
 */
export function StatusChip({ state, progress, icon, children, ...rest }: StatusChipProps) {
  return (
    <Chip
      role="status"
      aria-live="polite"
      aria-busy={state === 'busy' || undefined}
      tone={STATE_TONES[state]}
      icon={icon ?? stateIcon(state, progress)}
      {...rest}
    >
      {children}
    </Chip>
  );
}
