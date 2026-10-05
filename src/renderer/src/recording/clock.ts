// Time as the app core sees it. Everything that waits or animates goes through this
// interface, so the recording state machine and the gesture loop run under vitest with a
// hand-driven clock.

export interface Clock {
  /** Monotonic milliseconds on the performance.now() timeline. */
  nowMs(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  /** requestAnimationFrame: the callback receives the frame time on the nowMs() timeline. */
  requestFrame(callback: (nowMs: number) => void): number;
  cancelFrame(handle: number): void;
}

export function createBrowserClock(): Clock {
  return {
    nowMs: () => performance.now(),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  };
}

/** Resolves after `delayMs` on the given clock. */
export function sleep(clock: Clock, delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    clock.setTimeout(resolve, Math.max(0, delayMs));
  });
}

/**
 * Settles like `work`, unless it takes longer than `timeoutMs`: then it rejects, so a
 * device that stopped answering can never leave the app waiting forever.
 */
export function withTimeout<T>(
  clock: Clock,
  work: Promise<T>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = clock.setTimeout(() => {
      reject(new Error(`${description} did not finish within ${timeoutMs} ms`));
    }, timeoutMs);
    work.then(
      (value) => {
        clock.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clock.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
