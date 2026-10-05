// Keeps the toast area in step with StudioState.notices. The app owns the notices; the toast
// store owns what is on screen (timers, exit animations). This module decides, from both
// lists, which toasts to show or remove and which notices to report back as dismissed.
import type { Notice } from '@renderer/state/studioTypes';

export interface NoticeMemory {
  /** Notices that have been handed to the toast store and still exist in app state. */
  shown: ReadonlySet<string>;
  /** Notices whose dismissal has already been reported to the app. */
  reported: ReadonlySet<string>;
}

export const EMPTY_NOTICE_MEMORY: NoticeMemory = { shown: new Set(), reported: new Set() };

export interface NoticeSyncPlan {
  /** New notices to put on screen. */
  show: Notice[];
  /** Toasts to take down because the app removed their notice. */
  hide: string[];
  /** Notices whose toast is gone (closed, timed out, or pushed out): tell the app once. */
  dismiss: string[];
  memory: NoticeMemory;
}

export function planNoticeSync(
  notices: readonly Notice[],
  visibleToastIds: readonly string[],
  memory: NoticeMemory,
): NoticeSyncPlan {
  const noticeIds = new Set(notices.map((notice) => notice.id));
  const visible = new Set(visibleToastIds);

  const show = notices.filter((notice) => !memory.shown.has(notice.id));
  const hide = [...memory.shown].filter((id) => !noticeIds.has(id) && visible.has(id));
  const dismiss = notices
    .filter(
      (notice) =>
        memory.shown.has(notice.id) && !visible.has(notice.id) && !memory.reported.has(notice.id),
    )
    .map((notice) => notice.id);

  // Forget notices the app has removed, so their ids could be used again.
  const stillPresent = (id: string) => noticeIds.has(id);
  return {
    show,
    hide,
    dismiss,
    memory: {
      shown: new Set([...[...memory.shown].filter(stillPresent), ...show.map((n) => n.id)]),
      reported: new Set([...[...memory.reported].filter(stillPresent), ...dismiss]),
    },
  };
}
