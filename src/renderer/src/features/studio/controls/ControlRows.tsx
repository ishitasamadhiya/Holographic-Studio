import type { ControlId, ControlSource } from '@shared/controls';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { SegmentedControl, Slider } from '@renderer/ui';
import { CONTROL_COPY, CONTROL_ORDER } from './controlCopy';
import { describeGestureUnavailable, gestureUnavailableReason } from './gestureAvailability';
import styles from './ControlRows.module.css';

/**
 * The three vocal controls as rows: where each takes its value from (a hand or the slider)
 * and the slider itself. In Manual the slider is the live value; in Gesture it is where the
 * effect rests while the hand is out of view. Used by the Controls panel and by Settings.
 */
export function ControlRows() {
  const controls = useStudioState((state) => state.settings.controls);
  const mode = useStudioState((state) => state.settings.mode);
  const actions = useStudioActions();

  const unavailable = gestureUnavailableReason(mode, controls.handControlEnabled);
  const sourceOptions = [
    { value: 'gesture', label: 'Gesture', disabled: unavailable !== null },
    { value: 'manual', label: 'Manual' },
  ] as const satisfies readonly { value: ControlSource; label: string; disabled?: boolean }[];

  const renderRow = (id: ControlId) => {
    const copy = CONTROL_COPY[id];
    const source: ControlSource = unavailable ? 'manual' : controls[id].source;

    return (
      <div key={id} className={styles.row} data-testid={`control-row-${id}`} data-source={source}>
        <div className={styles.rowHeader}>
          <div className={styles.rowTitle}>
            <span className={styles.rowIcon} aria-hidden="true">
              {copy.icon}
            </span>
            <div className={styles.rowText}>
              <span className={styles.rowLabel}>{copy.label}</span>
              {source === 'gesture' && <span className={styles.rowHint}>{copy.gestureHint}</span>}
            </div>
          </div>
          <SegmentedControl
            size="sm"
            label={`${copy.label} is controlled by`}
            options={sourceOptions}
            value={source}
            onChange={(next) => actions.setControlSource(id, next)}
          />
        </div>
        <Slider
          label={source === 'gesture' ? `${copy.label} resting value` : copy.label}
          hideLabel
          value={controls[id].manual}
          unityValue={copy.unityValue}
          onChange={(value) => actions.setManualControl(id, value)}
        />
      </div>
    );
  };

  return (
    <div className={styles.rows}>
      {CONTROL_ORDER.map(renderRow)}
      <p className={styles.note} data-testid="control-rows-note">
        {unavailable
          ? describeGestureUnavailable(unavailable)
          : 'In Gesture, the slider sets where an effect rests while your hand is out of view.'}
      </p>
    </div>
  );
}
