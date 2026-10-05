/** The part of Electron's `app` the quit guard needs. */
export interface QuittableApp {
  on(event: 'will-quit', listener: (event: { preventDefault(): void }) => void): unknown;
  quit(): void;
}

export interface ShutdownWork {
  /** True while something still has to be stopped or cleaned up. */
  isPending(): boolean;
  /** Stops and cleans up everything that is left. */
  finish(): Promise<void>;
}

/** Clean-up takes milliseconds; this only keeps a stuck disk from making the app unquittable. */
export const MAX_QUIT_DELAY_MS = 5000;

/**
 * Makes the app finish its clean-up before it exits.
 *
 * Electron terminates as soon as the 'will-quit' listeners return; it does not wait for
 * promises. An export that is cancelled at that moment would be killed before it has removed
 * its half-written video from the user's folder. So while work is pending the quit is held
 * back, the work is finished, and the app is then told to quit again.
 *
 * 'will-quit' rather than 'before-quit': by then every window has closed, so the quit can
 * no longer be called off and nothing is stopped for a quit that does not happen.
 */
export function finishWorkBeforeQuitting(
  app: QuittableApp,
  work: ShutdownWork,
  maxDelayMs = MAX_QUIT_DELAY_MS,
): void {
  let state: 'running' | 'finishing' | 'finished' = 'running';

  app.on('will-quit', (event) => {
    if (state === 'finished') return;
    if (state === 'running' && !work.isPending()) return;

    event.preventDefault();
    if (state === 'finishing') return;
    state = 'finishing';
    void finishWithin(work, maxDelayMs).then(() => {
      state = 'finished';
      app.quit();
    });
  });
}

async function finishWithin(work: ShutdownWork, maxDelayMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeLimit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, maxDelayMs);
  });
  const finished = work.finish().catch((error: unknown) => {
    console.warn('Clean-up before quitting failed:', error);
  });
  await Promise.race([finished, timeLimit]);
  clearTimeout(timer);
}
