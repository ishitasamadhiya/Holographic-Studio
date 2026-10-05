import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishWorkBeforeQuitting, type QuittableApp, type ShutdownWork } from './quitGuard';

/** Stands in for Electron's app: counts quit() calls and lets a test fire 'will-quit'. */
class FakeApp implements QuittableApp {
  quitCalls = 0;
  private listener: ((event: { preventDefault(): void }) => void) | null = null;

  on(_event: 'will-quit', listener: (event: { preventDefault(): void }) => void): void {
    this.listener = listener;
  }

  quit(): void {
    this.quitCalls += 1;
  }

  /** Emits 'will-quit' and reports whether the quit was held back. */
  emitWillQuit(): boolean {
    let prevented = false;
    this.listener?.({
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  }
}

/** Work that stays pending until the test lets finish() complete. */
function controllableWork() {
  let pending = true;
  let finishCalls = 0;
  let complete: () => void = () => undefined;
  const work: ShutdownWork = {
    isPending: () => pending,
    finish: () => {
      finishCalls += 1;
      return new Promise<void>((resolve) => {
        complete = () => {
          pending = false;
          resolve();
        };
      });
    },
  };
  return { work, complete: () => complete(), finishCalls: () => finishCalls };
}

const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('finishWorkBeforeQuitting', () => {
  it('lets the app quit straight away when nothing is pending', () => {
    const app = new FakeApp();
    let finishCalls = 0;
    finishWorkBeforeQuitting(app, {
      isPending: () => false,
      finish: async () => {
        finishCalls += 1;
      },
    });

    expect(app.emitWillQuit()).toBe(false);
    expect(finishCalls).toBe(0);
    expect(app.quitCalls).toBe(0);
  });

  it('holds the quit until the pending work has finished, then quits again', async () => {
    const app = new FakeApp();
    const { work, complete, finishCalls } = controllableWork();
    finishWorkBeforeQuitting(app, work);

    expect(app.emitWillQuit()).toBe(true);
    expect(finishCalls()).toBe(1);
    await nextTick();
    // Still cleaning up: the app must not have been told to quit yet.
    expect(app.quitCalls).toBe(0);

    complete();
    await nextTick();
    expect(app.quitCalls).toBe(1);
    // The quit it asked for goes through.
    expect(app.emitWillQuit()).toBe(false);
  });

  it('keeps holding, without starting the work twice, when another quit arrives meanwhile', async () => {
    const app = new FakeApp();
    const { work, complete, finishCalls } = controllableWork();
    finishWorkBeforeQuitting(app, work);

    expect(app.emitWillQuit()).toBe(true);
    expect(app.emitWillQuit()).toBe(true);
    expect(finishCalls()).toBe(1);

    complete();
    await nextTick();
    expect(app.quitCalls).toBe(1);
  });

  it('quits anyway when the work fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = new FakeApp();
    finishWorkBeforeQuitting(app, {
      isPending: () => true,
      finish: () => Promise.reject(new Error('disk gone')),
    });

    expect(app.emitWillQuit()).toBe(true);
    await nextTick();
    expect(app.quitCalls).toBe(1);
    // Even though the work still claims to be pending, the second quit is not held again.
    expect(app.emitWillQuit()).toBe(false);
  });

  it('never holds the quit longer than the time limit', async () => {
    const app = new FakeApp();
    finishWorkBeforeQuitting(
      app,
      { isPending: () => true, finish: () => new Promise<void>(() => undefined) },
      30,
    );

    expect(app.emitWillQuit()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(app.quitCalls).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(app.quitCalls).toBe(1);
    expect(app.emitWillQuit()).toBe(false);
  });
});
