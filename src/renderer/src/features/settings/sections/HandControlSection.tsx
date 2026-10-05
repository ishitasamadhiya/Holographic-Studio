import { useState } from 'react';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { Button, FormRow, FormSection, Toggle } from '@renderer/ui';
import { ControlRows } from '../../studio/controls/ControlRows';

type CalibrationState = 'idle' | 'measuring' | 'saved' | 'no-hand';

const CALIBRATION_HINTS: Record<CalibrationState, string> = {
  idle: 'Hold your right hand up where it is comfortable, then press the button.',
  measuring: 'Hold still…',
  saved: 'Saved. Volume is now centred on this distance.',
  'no-hand': 'No hand was seen. Hold your right hand up and try again.',
};

export function HandControlSection({ locked }: { locked: boolean }) {
  const controls = useStudioState((state) => state.settings.controls);
  const canCalibrate = useStudioState(
    (state) =>
      state.settings.mode === 'video' &&
      state.settings.controls.handControlEnabled &&
      state.tracking.status === 'running',
  );
  const actions = useStudioActions();
  const [calibration, setCalibration] = useState<CalibrationState>('idle');

  const calibrate = () => {
    setCalibration('measuring');
    actions
      .calibrateHandDistance()
      .then((seen) => setCalibration(seen === false ? 'no-hand' : 'saved'))
      .catch(() => setCalibration('no-hand'));
  };

  return (
    <FormSection title="Hand control" data-testid="settings-hand-control">
      <FormRow label="Control effects with my hands" hint="The camera follows your hands">
        <Toggle
          checked={controls.handControlEnabled}
          onChange={(handControlEnabled) =>
            actions.updateSettings({ controls: { handControlEnabled } })
          }
          data-testid="settings-hand-control-toggle"
        />
      </FormRow>
      <ControlRows />
      <FormRow
        label="Resting distance"
        hint={
          canCalibrate
            ? CALIBRATION_HINTS[calibration]
            : 'Available in Video mode while hand control is running.'
        }
      >
        <Button
          size="sm"
          loading={calibration === 'measuring'}
          disabled={!canCalibrate || locked}
          onClick={calibrate}
          data-testid="settings-calibrate"
        >
          Set my resting distance
        </Button>
      </FormRow>
      <FormRow
        label="Extra gestures"
        hint="Experimental. A peace sign toggles reverb; both fists held start or stop recording."
      >
        <Toggle
          checked={controls.extraGesturesEnabled}
          onChange={(extraGesturesEnabled) =>
            actions.updateSettings({ controls: { extraGesturesEnabled } })
          }
          data-testid="settings-extra-gestures"
        />
      </FormRow>
    </FormSection>
  );
}
