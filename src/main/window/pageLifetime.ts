import type { WebContents } from 'electron';

/**
 * Calls `listener` every time the page a web contents was showing is gone for good:
 * it loaded another document (a reload included), its process died, or it was closed.
 */
export function onPageGone(contents: WebContents, listener: () => void): void {
  // Emitted when a main-frame navigation has committed. Navigations within the page
  // (hash changes, history.pushState) keep its JavaScript alive and do not emit it.
  contents.on('did-navigate', listener);
  contents.on('render-process-gone', listener);
  contents.once('destroyed', listener);
}
