import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { LiveReadouts, Studio, StudioActions, StudioState } from './studioTypes';

const StudioContext = createContext<Studio | null>(null);

export function StudioProvider({ studio, children }: { studio: Studio; children: ReactNode }) {
  return <StudioContext.Provider value={studio}>{children}</StudioContext.Provider>;
}

function useStudio(): Studio {
  const studio = useContext(StudioContext);
  if (!studio) throw new Error('StudioProvider is missing above this component');
  return studio;
}

/** Subscribes to a slice of app state; re-renders only when that slice changes. */
export function useStudioState<T>(selector: (state: StudioState) => T): T {
  return useStore(useStudio().store, selector);
}

export function useStudioActions(): StudioActions {
  return useStudio().actions;
}

/**
 * Runs `onFrame` once per animation frame with the live readouts, without re-rendering.
 * Use it to drive meters and indicators imperatively.
 */
export function useLiveFrame(onFrame: (live: LiveReadouts) => void): void {
  const { live } = useStudio();
  const callback = useRef(onFrame);

  useEffect(() => {
    callback.current = onFrame;
  });

  useEffect(() => {
    let frameId = requestAnimationFrame(function tick() {
      callback.current(live);
      frameId = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frameId);
  }, [live]);
}
