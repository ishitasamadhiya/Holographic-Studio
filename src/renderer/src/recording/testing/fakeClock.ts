// A clock the tests move by hand. Timers fire in time order as the clock advances; animation
// frames run only when a test asks for one.
import type { Clock } from '../clock';

interface PendingTimer {
  handle: number;
  dueMs: number;
  callback: () => void;
}

/** Lets every promise continuation that is ready run (a real zero-delay timer does that). */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export class FakeClock implements Clock {
  private currentMs: number;
  private nextHandle = 1;
  private timers: PendingTimer[] = [];
  private frames = new Map<number, (nowMs: number) => void>();

  constructor(startMs = 1000) {
    this.currentMs = startMs;
  }

  nowMs(): number {
    return this.currentMs;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.timers.push({ handle, dueMs: this.currentMs + Math.max(0, delayMs), callback });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers = this.timers.filter((timer) => timer.handle !== handle);
  }

  requestFrame(callback: (nowMs: number) => void): number {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number): void {
    this.frames.delete(handle);
  }

  get pendingTimerCount(): number {
    return this.timers.length;
  }

  get pendingFrameCount(): number {
    return this.frames.size;
  }

  /**
   * Moves time forward, firing every timer that comes due (including ones scheduled along
   * the way) and letting promise continuations run after each.
   */
  async advance(durationMs: number): Promise<void> {
    const targetMs = this.currentMs + durationMs;
    await flushPromises();
    for (;;) {
      const next = this.timers
        .filter((timer) => timer.dueMs <= targetMs)
        .sort((a, b) => a.dueMs - b.dueMs || a.handle - b.handle)[0];
      if (!next) break;
      this.clearTimeout(next.handle);
      this.currentMs = Math.max(this.currentMs, next.dueMs);
      next.callback();
      await flushPromises();
    }
    this.currentMs = targetMs;
    await flushPromises();
  }

  /** Runs the animation-frame callbacks requested so far, optionally after moving time on. */
  async runFrame(advanceMs = 0): Promise<void> {
    if (advanceMs > 0) await this.advance(advanceMs);
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks) callback(this.currentMs);
    await flushPromises();
  }
}
