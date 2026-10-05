import { useEffect, useState } from 'react';
import { readDurationMs } from './motion';

export interface Presence {
  /** True while the element should be in the DOM (open, or still playing its exit animation). */
  rendered: boolean;
  /** True during the exit animation. */
  exiting: boolean;
}

/**
 * Keeps a closing overlay mounted while its exit animation plays. The exit animation must
 * last `--duration-base`, which is read from the stylesheet at the moment of closing (so it
 * is all but instant for people who ask for reduced motion).
 */
export function usePresence(open: boolean): Presence {
  const [rendered, setRendered] = useState(open);
  if (open && !rendered) setRendered(true);

  useEffect(() => {
    if (open || !rendered) return;
    const timer = window.setTimeout(() => setRendered(false), readDurationMs('--duration-base'));
    return () => window.clearTimeout(timer);
  }, [open, rendered]);

  return { rendered, exiting: rendered && !open };
}
