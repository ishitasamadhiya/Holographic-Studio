import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import {
  CameraIcon,
  Field,
  FormSection,
  HeadphonesIcon,
  MicrophoneIcon,
  Select,
} from '@renderer/ui';
import { runAction } from '../../studio/runAction';
import { buildDeviceOptions, deviceIdToSelectValue, selectValueToDeviceId } from '../settingsText';

/** Shown in a picker whose remembered device is not plugged in at the moment. */
const MISSING_DEVICE = 'Not connected';

export function DevicesSection({ locked }: { locked: boolean }) {
  const devices = useStudioState((state) => state.devices);
  const selected = useStudioState((state) => state.settings.devices);
  const actions = useStudioActions();

  return (
    <FormSection title="Devices" data-testid="settings-devices">
      <Field label="Microphone">
        <Select
          options={buildDeviceOptions(devices.microphones, 'Microphone')}
          value={deviceIdToSelectValue(selected.microphoneId)}
          onChange={(value) => runAction(actions.selectMicrophone(selectValueToDeviceId(value)))}
          placeholder={MISSING_DEVICE}
          icon={<MicrophoneIcon />}
          disabled={locked}
          data-testid="settings-microphone"
        />
      </Field>
      <Field label="Camera">
        <Select
          options={buildDeviceOptions(devices.cameras, 'Camera')}
          value={deviceIdToSelectValue(selected.cameraId)}
          onChange={(value) => runAction(actions.selectCamera(selectValueToDeviceId(value)))}
          placeholder={MISSING_DEVICE}
          icon={<CameraIcon />}
          disabled={locked}
          data-testid="settings-camera"
        />
      </Field>
      <Field
        label="Headphones"
        hint={
          devices.outputSelectionSupported
            ? 'Headphones keep the music out of your microphone.'
            : 'Sound plays through the output chosen in your system settings.'
        }
      >
        <Select
          options={buildDeviceOptions(
            devices.outputSelectionSupported ? devices.outputs : [],
            'Output',
          )}
          value={deviceIdToSelectValue(devices.outputSelectionSupported ? selected.outputId : null)}
          onChange={(value) => runAction(actions.selectOutput(selectValueToDeviceId(value)))}
          placeholder={MISSING_DEVICE}
          icon={<HeadphonesIcon />}
          disabled={locked || !devices.outputSelectionSupported}
          data-testid="settings-output"
        />
      </Field>
    </FormSection>
  );
}
