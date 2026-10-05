import { type RefObject, useRef, useState } from 'react';
import { CONTROL_IDS, type ControlId } from '@shared/controls';
import { useLiveFrame, useStudioState } from '@renderer/state/studioContext';
import { isGestureControlled } from '@renderer/state/studioTypes';
import {
  ControlIndicator,
  type ControlIndicatorHandle,
  type ControlIndicatorStatus,
  cx,
} from '@renderer/ui';
import { CONTROL_COPY } from '../controls/controlCopy';
import { toIndicatorStatus } from './indicatorStatus';
import styles from './EdgeIndicators.module.css';

type IndicatorStatuses = Record<ControlId, ControlIndicatorStatus>;

/**
 * The live readouts at the edges of the preview. The preview is mirrored, so the singer's
 * right hand appears on the right: Autotune and Volume (right hand) sit on the right edge,
 * Echo (left hand) on the left.
 *
 * Values are written straight to the indicators on every animation frame. React only
 * re-renders when a control's status changes (live, holding, …), which is rare.
 *
 * @param panelOpen the Controls panel is open in the bottom-right corner, where it would
 *   cover the right edge, so that edge makes way.
 */
export function EdgeIndicators({ panelOpen }: { panelOpen: boolean }) {
  const gestureControlled: Record<ControlId, boolean> = {
    autotune: useStudioState((state) => isGestureControlled(state, 'autotune')),
    echo: useStudioState((state) => isGestureControlled(state, 'echo')),
    volume: useStudioState((state) => isGestureControlled(state, 'volume')),
  };

  const handles: Record<ControlId, RefObject<ControlIndicatorHandle | null>> = {
    autotune: useRef<ControlIndicatorHandle>(null),
    echo: useRef<ControlIndicatorHandle>(null),
    volume: useRef<ControlIndicatorHandle>(null),
  };

  const [statuses, setStatuses] = useState<IndicatorStatuses>(() => ({
    autotune: toIndicatorStatus('manual', gestureControlled.autotune),
    echo: toIndicatorStatus('manual', gestureControlled.echo),
    volume: toIndicatorStatus('manual', gestureControlled.volume),
  }));
  const shownStatuses = useRef(statuses);

  useLiveFrame((live) => {
    let next: IndicatorStatuses | null = null;
    for (const id of CONTROL_IDS) {
      handles[id].current?.setValue(live.controls[id]);
      const status = toIndicatorStatus(live.controlStatus[id], gestureControlled[id]);
      if (status !== shownStatuses.current[id]) {
        next ??= { ...shownStatuses.current };
        next[id] = status;
      }
    }
    if (next) {
      shownStatuses.current = next;
      setStatuses(next);
    }
  });

  const renderIndicator = (id: ControlId) => {
    const copy = CONTROL_COPY[id];
    return (
      <ControlIndicator
        key={id}
        ref={handles[id]}
        label={copy.label}
        icon={copy.icon}
        status={statuses[id]}
        unityValue={copy.unityValue}
        data-testid={`indicator-${id}`}
      />
    );
  };

  return (
    <>
      <div className={cx(styles.edge, styles.left)} data-testid="edge-left">
        {renderIndicator('echo')}
      </div>
      <div
        className={cx(styles.edge, styles.right)}
        data-covered={panelOpen || undefined}
        data-testid="edge-right"
      >
        {renderIndicator('autotune')}
        {renderIndicator('volume')}
      </div>
    </>
  );
}
