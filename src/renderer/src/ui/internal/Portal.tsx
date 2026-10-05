import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Renders overlays at the end of <body> so no ancestor can clip them or trap their z-index. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
