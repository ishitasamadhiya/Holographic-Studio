import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { type ToastStore, ToastViewport } from '@renderer/ui';
import { EMPTY_NOTICE_MEMORY, planNoticeSync } from './noticeSync';

/** Keeps toasts that mirror an app notice apart from the screen's own toasts. */
const NOTICE_TOAST_PREFIX = 'notice:';

export interface NoticeToastsProps {
  store: ToastStore;
  /**
   * A message already on screen in the problem card. A notice saying the same thing is
   * dropped instead of repeated as a toast (and does not pop up once the problem is solved).
   */
  shownElsewhere: string | null;
}

/**
 * The toast area. App notices appear here as toasts; when one is closed, times out or is
 * pushed out by newer ones, the app is told to forget the notice.
 */
export function NoticeToasts({ store, shownElsewhere }: NoticeToastsProps) {
  const notices = useStudioState((state) => state.notices);
  const actions = useStudioActions();
  // Only read to re-run the effect when a toast comes or goes.
  const toasts = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const memory = useRef(EMPTY_NOTICE_MEMORY);

  useEffect(() => {
    const repeated = notices.filter((notice) => notice.message === shownElsewhere);
    for (const notice of repeated) actions.dismissNotice(notice.id);
    const visibleNoticeIds = store
      .getSnapshot()
      .filter((toast) => toast.id.startsWith(NOTICE_TOAST_PREFIX))
      .map((toast) => toast.id.slice(NOTICE_TOAST_PREFIX.length));
    const plan = planNoticeSync(
      notices.filter((notice) => notice.message !== shownElsewhere),
      visibleNoticeIds,
      memory.current,
    );
    memory.current = plan.memory;

    for (const notice of plan.show) {
      store.show({
        id: NOTICE_TOAST_PREFIX + notice.id,
        title: notice.message,
        tone: notice.kind,
      });
    }
    for (const id of plan.hide) store.dismiss(NOTICE_TOAST_PREFIX + id);
    for (const id of plan.dismiss) actions.dismissNotice(id);
  }, [notices, toasts, store, actions, shownElsewhere]);

  return <ToastViewport store={store} />;
}
