import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { cx } from './internal/classNames';
import { MODAL_COMPANION_ATTRIBUTE } from './internal/focusTrap';
import { readDurationMs } from './internal/motion';
import { Portal } from './internal/Portal';
import { Toast } from './Toast';
import { type ToastRecord, type ToastStore, toastStore } from './toastStore';
import styles from './Toast.module.css';

export type ToastPlacement = 'top' | 'bottom';

export interface ToastViewportProps {
  /** Defaults to the app-wide `toastStore`. */
  store?: ToastStore;
  placement?: ToastPlacement;
}

interface ToastItemProps {
  toast: ToastRecord;
  /** Called when `toast` has finished its exit animation. */
  onExited: (toast: ToastRecord) => void;
}

/** Owns one toast's lifetime: the auto-dismiss timer, pausing it, and the exit animation. */
function ToastItem({ toast, onExited }: ToastItemProps) {
  const [isLeaving, setIsLeaving] = useState(false);
  // People must be able to finish reading (or reach the button) without racing the timer.
  const [isPaused, setIsPaused] = useState(false);

  // The store replaces the record when a toast is shown again under the same id. Whatever
  // the old one was doing (possibly already on its way out), the new one starts fresh;
  // otherwise a repeated error would be dismissed by its predecessor's exit.
  const [shownToast, setShownToast] = useState(toast);
  if (shownToast !== toast) {
    setShownToast(toast);
    setIsLeaving(false);
  }

  useEffect(() => {
    if (toast.durationMs === null || isPaused || isLeaving) return;
    const timer = window.setTimeout(() => setIsLeaving(true), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [toast, isPaused, isLeaving]);

  useEffect(() => {
    if (!isLeaving) return;
    // The `leave` animation in Toast.module.css runs for --duration-base.
    const timer = window.setTimeout(() => onExited(toast), readDurationMs('--duration-base'));
    return () => window.clearTimeout(timer);
  }, [isLeaving, onExited, toast]);

  return (
    <Toast
      toast={toast}
      leaving={isLeaving}
      onDismiss={() => setIsLeaving(true)}
      onPointerEnter={() => setIsPaused(true)}
      onPointerLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
    />
  );
}

/**
 * Renders the toasts of a store, stacked at the top (default) or bottom centre of the window.
 * Mount it once, near the root of the app. Toasts stay on top of sheets and dialogs and
 * remain reachable with Tab while one is open.
 */
export function ToastViewport({ store = toastStore, placement = 'top' }: ToastViewportProps) {
  const toasts = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const remove = useCallback(
    (toast: ToastRecord) => {
      // Only if this very record is still showing: its id may belong to a newer toast by now.
      if (store.getSnapshot().includes(toast)) store.dismiss(toast.id);
    },
    [store],
  );
  const companionMarker = { [MODAL_COMPANION_ATTRIBUTE]: '' };

  return (
    <Portal>
      <div
        role="region"
        aria-label="Notifications"
        className={cx(styles.viewport, styles[placement])}
        data-testid="toast-viewport"
        {...companionMarker}
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onExited={remove} />
        ))}
      </div>
    </Portal>
  );
}
