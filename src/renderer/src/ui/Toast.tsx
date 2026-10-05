import type { HTMLAttributes, Ref } from 'react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { CloseIcon } from './icons';
import { cx } from './internal/classNames';
import { toneIcon } from './internal/tone';
import type { ToastRecord } from './toastStore';
import styles from './Toast.module.css';

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  toast: ToastRecord;
  onDismiss: () => void;
  /** Plays the exit animation (the viewport removes the toast when it has finished). */
  leaving?: boolean;
  ref?: Ref<HTMLDivElement>;
}

/** One notification card. Usually rendered by ToastViewport rather than directly. */
export function Toast({ toast, onDismiss, leaving = false, className, ref, ...rest }: ToastProps) {
  const isUrgent = toast.tone === 'warning' || toast.tone === 'error';
  const { action } = toast;

  return (
    <div
      ref={ref}
      // Urgent tones interrupt the screen reader; the others wait their turn.
      role={isUrgent ? 'alert' : 'status'}
      className={cx(styles.toast, leaving && styles.leaving, className)}
      data-tone={toast.tone}
      data-testid="toast"
      {...rest}
    >
      <span className={styles.icon} aria-hidden="true">
        {toneIcon(toast.tone)}
      </span>
      <div className={styles.body}>
        <p className={styles.title}>{toast.title}</p>
        {toast.description && <p className={styles.description}>{toast.description}</p>}
      </div>
      {action && (
        <Button
          size="sm"
          variant="secondary"
          className={styles.action}
          onClick={() => {
            // Dismiss first: the action may show a new toast under this same id (a retry
            // that fails again), and that one has to stay.
            onDismiss();
            action.onAction();
          }}
        >
          {action.label}
        </Button>
      )}
      <IconButton label="Dismiss" variant="ghost" size="sm" onClick={onDismiss}>
        <CloseIcon />
      </IconButton>
    </div>
  );
}
