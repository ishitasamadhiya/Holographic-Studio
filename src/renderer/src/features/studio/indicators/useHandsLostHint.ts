import { useRef, useState } from 'react';
import { useLiveFrame } from '@renderer/state/studioContext';
import { areBothHandsLost, createHandsLostTimer } from './handsLost';

/**
 * True while hand control is in use but no hand has been in view for a couple of seconds.
 * @param active whether any control is following a hand right now
 */
export function useHandsLostHint(active: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const shown = useRef(false);
  const timer = useRef(createHandsLostTimer());

  useLiveFrame((live) => {
    if (!active) timer.current.reset();
    const next = active && timer.current.update(areBothHandsLost(live.gesture), performance.now());
    if (next !== shown.current) {
      shown.current = next;
      setVisible(next);
    }
  });

  return visible;
}
