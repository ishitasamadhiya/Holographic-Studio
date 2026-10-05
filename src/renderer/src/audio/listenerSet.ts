import type { Unsubscribe } from '@shared/ipc';

/**
 * Subscribers to one engine event. A listener that throws is reported and skipped, so one
 * faulty subscriber can never stop the others (or the audio engine) from hearing about it.
 */
export class ListenerSet<T> {
  private readonly listeners = new Set<(value: T) => void>();

  constructor(private readonly reportFailure: (error: unknown) => void) {}

  add(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (error) {
        this.reportFailure(error);
      }
    }
  }
}
