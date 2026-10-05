// A tiny framework-free store for toast notifications. Any code (UI or not) can call
// `toastStore.show(...)`; a mounted <ToastViewport /> renders whatever is in the store.
import type { MessageTone } from './internal/tone';

export type ToastTone = MessageTone;

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** One optional button, e.g. "Open Settings" or "Retry". Pressing it also dismisses. */
  action?: ToastAction;
  /** Auto-dismiss delay. null keeps the toast until it is dismissed. Defaults depend on tone. */
  durationMs?: number | null;
  /** Showing a toast with the id of a visible one replaces it instead of stacking a copy. */
  id?: string;
}

export interface ToastRecord {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  action?: ToastAction;
  durationMs: number | null;
}

export interface ToastStore {
  /** Adds (or replaces) a toast and returns its id. */
  show(input: ToastInput): string;
  dismiss(id: string): void;
  clear(): void;
  /** Oldest first. The array is replaced, never mutated, on every change. */
  getSnapshot(): readonly ToastRecord[];
  subscribe(listener: () => void): () => void;
}

export interface ToastStoreOptions {
  /** When more toasts than this are shown, the oldest ones are dropped. */
  maxVisible?: number;
}

/** Errors stay longer than confirmations: they need reading, and often a decision. */
export const DEFAULT_TOAST_DURATION_MS: Record<ToastTone, number> = {
  info: 4000,
  success: 4000,
  warning: 6500,
  error: 9000,
};

/** A toast with a button gets extra time so it can be reached with the keyboard. */
const ACTION_EXTRA_MS = 3000;

export function createToastStore({ maxVisible = 3 }: ToastStoreOptions = {}): ToastStore {
  let toasts: readonly ToastRecord[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();

  const publish = (next: readonly ToastRecord[]) => {
    toasts = next;
    listeners.forEach((listener) => listener());
  };

  return {
    show(input) {
      const tone = input.tone ?? 'info';
      const id = input.id ?? `toast-${nextId++}`;
      const record: ToastRecord = {
        id,
        title: input.title,
        description: input.description,
        tone,
        action: input.action,
        durationMs:
          input.durationMs === undefined
            ? DEFAULT_TOAST_DURATION_MS[tone] + (input.action ? ACTION_EXTRA_MS : 0)
            : input.durationMs,
      };

      const isReplacement = toasts.some((toast) => toast.id === id);
      const next = isReplacement
        ? toasts.map((toast) => (toast.id === id ? record : toast))
        : [...toasts, record];
      publish(next.slice(Math.max(0, next.length - maxVisible)));
      return id;
    },

    dismiss(id) {
      if (toasts.some((toast) => toast.id === id)) {
        publish(toasts.filter((toast) => toast.id !== id));
      }
    },

    clear() {
      if (toasts.length > 0) publish([]);
    },

    getSnapshot: () => toasts,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The app-wide store rendered by the default <ToastViewport />. */
export const toastStore = createToastStore();
