// The queue of transient messages behind the toast area.
import type { Notice } from '@renderer/state/studioTypes';

/** Older notices drop off the front once the queue is this long. */
export const MAX_NOTICES = 5;

/** Appends a notice, unless it only repeats the message of the newest one already queued. */
export function withNotice(notices: readonly Notice[], notice: Notice): Notice[] {
  if (notices.at(-1)?.message === notice.message) return [...notices];
  return [...notices, notice].slice(-MAX_NOTICES);
}

export function withoutNotice(notices: readonly Notice[], id: string): Notice[] {
  return notices.filter((notice) => notice.id !== id);
}
