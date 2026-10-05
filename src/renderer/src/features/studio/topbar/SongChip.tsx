import type { ReactNode } from 'react';
import { CloseIcon, cx, IconButton, ProgressRing, Spinner, WarningIcon } from '@renderer/ui';
import type { SongChipView } from './songLabels';
import styles from './SongChip.module.css';

export interface SongChipProps {
  view: SongChipView;
  /** Shown while the chip invites adding a file and once the file is ready. */
  icon: ReactNode;
  /** Opens the file dialog. Omit while files cannot be changed (a take is in progress). */
  onChoose?: () => void;
  /** Removes the file. Omit while files cannot be changed. */
  onRemove?: () => void;
  removeLabel: string;
  /** Extra control after the name of a ready file, e.g. the preview button. */
  trailing?: ReactNode;
  'data-testid': string;
}

/**
 * One quiet capsule in the top bar for a song file. Unlike the design system's Chip it can
 * hold buttons: the whole capsule is a button while it invites adding a file, and a loaded
 * file gets small actions after its name.
 */
export function SongChip({
  view,
  icon,
  onChoose,
  onRemove,
  removeLabel,
  trailing,
  'data-testid': testId,
}: SongChipProps) {
  if (view.kind === 'add') {
    // Nothing to show for a missing file once it can no longer be added.
    if (!onChoose) return null;
    return (
      <button
        type="button"
        className={cx(styles.chip, styles.action)}
        title={view.description}
        onClick={onChoose}
        data-testid={testId}
        data-kind={view.kind}
      >
        <span className={styles.icon}>{icon}</span>
        <span className={styles.text}>{view.text}</span>
      </button>
    );
  }

  const removeButton = onRemove && (
    <IconButton
      label={removeLabel}
      variant="ghost"
      size="sm"
      className={styles.chipButton}
      onClick={onRemove}
    >
      <CloseIcon />
    </IconButton>
  );

  if (view.kind === 'busy') {
    return (
      <span
        className={styles.chip}
        role="status"
        aria-live="polite"
        aria-busy="true"
        title={view.description}
        data-testid={testId}
        data-kind={view.kind}
      >
        <span className={cx(styles.icon, styles.busyIcon)}>
          {view.progress === null ? (
            <Spinner size="sm" label={null} />
          ) : (
            <ProgressRing value={view.progress} size={14} strokeWidth={2} label={null} />
          )}
        </span>
        <span className={styles.text}>{view.text}</span>
        {view.detail && <span className={styles.detail}>{view.detail}</span>}
      </span>
    );
  }

  if (view.kind === 'failed') {
    return (
      <span
        className={styles.chip}
        role="status"
        title={view.description}
        data-testid={testId}
        data-kind={view.kind}
        data-has-actions={removeButton ? '' : undefined}
      >
        <span className={cx(styles.icon, styles.warningIcon)}>
          <WarningIcon />
        </span>
        {onChoose ? (
          <button type="button" className={styles.textButton} onClick={onChoose}>
            {view.text}
          </button>
        ) : (
          <span className={styles.text}>{view.text}</span>
        )}
        {removeButton}
      </span>
    );
  }

  return (
    <span
      className={styles.chip}
      title={view.description}
      data-testid={testId}
      data-kind={view.kind}
      data-has-actions={trailing || removeButton ? '' : undefined}
    >
      <span className={styles.icon}>{icon}</span>
      <span className={styles.text}>{view.text}</span>
      {view.detail && <span className={styles.detail}>{view.detail}</span>}
      {trailing}
      {removeButton}
    </span>
  );
}

/** A small round button sized to sit inside a SongChip. */
export function SongChipButton({
  label,
  pressed,
  onClick,
  children,
  'data-testid': testId,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <IconButton
      label={label}
      variant="ghost"
      size="sm"
      pressed={pressed}
      className={styles.chipButton}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </IconButton>
  );
}
