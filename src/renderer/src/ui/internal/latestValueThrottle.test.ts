import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLatestValueThrottle } from './latestValueThrottle';

describe('latest-value throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers the first value immediately', () => {
    const deliver = vi.fn();
    const throttle = createLatestValueThrottle<number>(400, deliver);

    throttle.push(0.2);
    expect(deliver.mock.calls).toEqual([[0.2]]);
  });

  it('delivers a value pushed inside the interval once the interval ends', () => {
    const deliver = vi.fn();
    const throttle = createLatestValueThrottle<number>(400, deliver);

    // The situation that used to leave screen readers with a stale value: one update on
    // mount, one shortly after, then silence.
    throttle.push(0);
    vi.advanceTimersByTime(50);
    throttle.push(0.64);
    expect(deliver).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(349);
    expect(deliver).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(deliver.mock.calls).toEqual([[0], [0.64]]);
  });

  it('keeps only the latest of several values pushed inside one interval', () => {
    const deliver = vi.fn();
    const throttle = createLatestValueThrottle<number>(400, deliver);

    throttle.push(1);
    throttle.push(2);
    throttle.push(3);
    vi.advanceTimersByTime(400);
    expect(deliver.mock.calls).toEqual([[1], [3]]);
  });

  it('limits a continuous stream to one delivery per interval', () => {
    const deliver = vi.fn();
    const throttle = createLatestValueThrottle<number>(250, deliver);

    // 60 pushes a second for one second.
    for (let frame = 0; frame < 60; frame += 1) {
      throttle.push(frame);
      vi.advanceTimersByTime(1000 / 60);
    }
    expect(deliver.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(deliver.mock.calls.length).toBeLessThanOrEqual(5);

    // After the stream stops, the final value still arrives.
    vi.advanceTimersByTime(250);
    expect(deliver.mock.lastCall).toEqual([59]);
  });

  it('schedules nothing while idle', () => {
    const deliver = vi.fn();
    const throttle = createLatestValueThrottle<number>(400, deliver);

    throttle.push(1);
    vi.advanceTimersByTime(400);
    expect(vi.getTimerCount()).toBe(0);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('flush delivers at once and supersedes a waiting value', () => {
    const deliver = vi.fn();
    const throttle = createLatestValueThrottle<number>(400, deliver);

    throttle.push(1);
    throttle.push(2);
    throttle.flush(9);
    expect(deliver.mock.calls).toEqual([[1], [9]]);

    vi.advanceTimersByTime(1000);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('cancel drops the waiting value and leaves the throttle usable', () => {
    const deliver = vi.fn();
    const throttle = createLatestValueThrottle<number>(400, deliver);

    throttle.push(1);
    throttle.push(2);
    throttle.cancel();
    vi.advanceTimersByTime(1000);
    expect(deliver.mock.calls).toEqual([[1]]);
    expect(vi.getTimerCount()).toBe(0);

    throttle.push(3);
    expect(deliver.mock.lastCall).toEqual([3]);
  });
});
