/**
 * Keeps track of background work (file clean-up, mostly) that nobody awaits, so the app
 * can let it finish before it exits.
 */
export class PendingWork {
  private readonly running = new Set<Promise<void>>();

  /** Watches `work` until it settles. Whether it succeeds or fails is the caller's business. */
  track(work: Promise<unknown>): void {
    const settled: Promise<void> = work
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => {
        this.running.delete(settled);
      });
    this.running.add(settled);
  }

  get isIdle(): boolean {
    return this.running.size === 0;
  }

  /** Resolves once nothing is running any more, including work added while waiting. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all(this.running);
  }
}
