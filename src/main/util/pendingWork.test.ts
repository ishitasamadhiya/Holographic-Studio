import { describe, expect, it } from 'vitest';
import { PendingWork } from './pendingWork';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('PendingWork', () => {
  it('is idle until work is tracked and again once all of it has settled', async () => {
    const pending = new PendingWork();
    expect(pending.isIdle).toBe(true);
    await pending.idle();

    const first = deferred();
    const second = deferred();
    pending.track(first.promise);
    pending.track(second.promise);
    expect(pending.isIdle).toBe(false);

    let idle = false;
    const waiting = pending.idle().then(() => {
      idle = true;
    });
    first.resolve();
    await first.promise;
    await Promise.resolve();
    expect(idle).toBe(false);

    second.resolve();
    await waiting;
    expect(pending.isIdle).toBe(true);
  });

  it('counts failed work as settled, without throwing', async () => {
    const pending = new PendingWork();
    const failing = deferred();
    pending.track(failing.promise);
    failing.reject(new Error('disk full'));
    await expect(pending.idle()).resolves.toBeUndefined();
    expect(pending.isIdle).toBe(true);
  });

  it('idle() also waits for work that was added while it was waiting', async () => {
    const pending = new PendingWork();
    const first = deferred();
    const late = deferred();
    pending.track(first.promise);

    let idle = false;
    const waiting = pending.idle().then(() => {
      idle = true;
    });
    pending.track(late.promise);
    first.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(idle).toBe(false);

    late.resolve();
    await waiting;
    expect(idle).toBe(true);
  });
});
