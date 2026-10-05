import { describe, expect, it, vi } from 'vitest';
import { createToastStore, DEFAULT_TOAST_DURATION_MS } from './toastStore';

describe('toast store', () => {
  it('adds toasts oldest-first with defaults filled in', () => {
    const store = createToastStore();
    const first = store.show({ title: 'Saved' });
    const second = store.show({ title: 'No camera found', tone: 'error' });

    expect(first).not.toBe(second);
    expect(store.getSnapshot()).toEqual([
      {
        id: first,
        title: 'Saved',
        description: undefined,
        tone: 'info',
        action: undefined,
        durationMs: DEFAULT_TOAST_DURATION_MS.info,
      },
      {
        id: second,
        title: 'No camera found',
        description: undefined,
        tone: 'error',
        action: undefined,
        durationMs: DEFAULT_TOAST_DURATION_MS.error,
      },
    ]);
  });

  it('gives toasts with an action more time, and respects explicit durations', () => {
    const store = createToastStore();
    store.show({
      title: 'Mic unplugged',
      tone: 'warning',
      action: { label: 'Fix', onAction: vi.fn() },
    });
    store.show({ title: 'Sticky', durationMs: null });
    store.show({ title: 'Quick', durationMs: 500 });

    const [withAction, sticky, quick] = store.getSnapshot();
    expect(withAction?.durationMs).toBeGreaterThan(DEFAULT_TOAST_DURATION_MS.warning);
    expect(sticky?.durationMs).toBeNull();
    expect(quick?.durationMs).toBe(500);
  });

  it('replaces a visible toast that has the same id instead of stacking a copy', () => {
    const store = createToastStore();
    store.show({ id: 'device', title: 'Microphone disconnected', tone: 'warning' });
    store.show({ title: 'Something else' });
    store.show({ id: 'device', title: 'Microphone reconnected', tone: 'success' });

    const titles = store.getSnapshot().map((toast) => toast.title);
    expect(titles).toEqual(['Microphone reconnected', 'Something else']);
  });

  it('drops the oldest toasts beyond the visible limit', () => {
    const store = createToastStore({ maxVisible: 2 });
    store.show({ title: 'one' });
    store.show({ title: 'two' });
    store.show({ title: 'three' });

    expect(store.getSnapshot().map((toast) => toast.title)).toEqual(['two', 'three']);
  });

  it('dismisses by id and clears everything', () => {
    const store = createToastStore();
    const first = store.show({ title: 'one' });
    store.show({ title: 'two' });

    store.dismiss(first);
    expect(store.getSnapshot().map((toast) => toast.title)).toEqual(['two']);

    store.clear();
    expect(store.getSnapshot()).toEqual([]);
  });

  it('notifies subscribers on real changes only, with a new snapshot each time', () => {
    const store = createToastStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const before = store.getSnapshot();
    const id = store.show({ title: 'one' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(before);

    store.dismiss('does-not-exist');
    expect(listener).toHaveBeenCalledTimes(1);

    store.dismiss(id);
    expect(listener).toHaveBeenCalledTimes(2);

    store.clear();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.show({ title: 'two' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
