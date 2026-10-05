import { describe, expect, it, vi } from 'vitest';
import { ListenerSet } from './listenerSet';

describe('ListenerSet', () => {
  it('delivers to every listener until it unsubscribes', () => {
    const set = new ListenerSet<number>(() => undefined);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = set.add(first);
    set.add(second);
    set.emit(1);
    unsubscribe();
    set.emit(2);
    expect(first.mock.calls).toEqual([[1]]);
    expect(second.mock.calls).toEqual([[1], [2]]);
  });

  it('reports a throwing listener and still reaches the others', () => {
    const failures: unknown[] = [];
    const set = new ListenerSet<string>((error) => failures.push(error));
    const after = vi.fn();
    set.add(() => {
      throw new Error('broken subscriber');
    });
    set.add(after);
    set.emit('chunk');
    expect(after).toHaveBeenCalledWith('chunk');
    expect(failures).toHaveLength(1);
    expect(String(failures[0])).toContain('broken subscriber');
  });

  it('lets a listener unsubscribe while being notified', () => {
    const set = new ListenerSet<number>(() => undefined);
    const later = vi.fn();
    const unsubscribeSelf = set.add(() => unsubscribeSelf());
    set.add(later);
    set.emit(1);
    set.emit(2);
    expect(later).toHaveBeenCalledTimes(2);
  });
});
