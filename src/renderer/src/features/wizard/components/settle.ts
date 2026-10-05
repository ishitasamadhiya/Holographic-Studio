/**
 * For actions started without waiting on them. They report their own failures through app
 * state; this only makes sure a stray rejection can never become an unhandled one.
 */
export function settle(task: Promise<unknown> | void): void {
  if (task) task.catch(() => undefined);
}
