import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { Banner, Field, HeadphonesIcon, Select } from '@renderer/ui';
import { settle } from '../components/settle';
import { StepFrame } from '../components/StepFrame';
import {
  deviceIdForSelectValue,
  deviceSelectOptions,
  selectValueForDevice,
} from '../logic/deviceChoices';
import styles from './steps.module.css';

export function HeadphonesStep() {
  const actions = useStudioActions();
  const outputs = useStudioState((state) => state.devices.outputs);
  const canChoose = useStudioState((state) => state.devices.outputSelectionSupported);
  const outputId = useStudioState((state) => state.settings.devices.outputId);

  return (
    <StepFrame
      title="Choose your headphones"
      lead="This is where you will hear the music and your own voice."
    >
      {canChoose ? (
        <Field label="Headphones">
          <Select
            icon={<HeadphonesIcon />}
            options={deviceSelectOptions(outputs)}
            value={selectValueForDevice(outputId)}
            placeholder="Choose headphones…"
            onChange={(value) => settle(actions.selectOutput(deviceIdForSelectValue(value)))}
            data-testid="wizard-output-select"
          />
        </Field>
      ) : (
        <p className={styles.note} data-testid="wizard-output-fixed">
          Sound will play through your computer’s current output. To change it, plug in your
          headphones or pick them in your computer’s sound settings.
        </p>
      )}

      <Banner tone="warning" icon={<HeadphonesIcon />} title="Use headphones.">
        They keep the music out of your microphone, so your recording stays clean.
      </Banner>
    </StepFrame>
  );
}
