/**
 * Runs asynchronous tasks strictly one after another, in the order they were added.
 * A failing task rejects its own promise but never blocks the tasks queued behind it.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Resolves once every task queued so far has settled. */
  async idle(): Promise<void> {
    await this.tail;
  }
}
