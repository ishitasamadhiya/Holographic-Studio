import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { FormRow, FormSection, Slider, Toggle } from '@renderer/ui';
import { formatCountdownSeconds } from '../settingsText';

export function RecordingSection() {
  const recording = useStudioState((state) => state.settings.recording);
  const actions = useStudioActions();

  return (
    <FormSection title="Recording" data-testid="settings-recording">
      <FormRow label="Countdown" hint="A short count-in before each take">
        <Toggle
          checked={recording.countdownEnabled}
          onChange={(countdownEnabled) =>
            actions.updateSettings({ recording: { countdownEnabled } })
          }
          data-testid="settings-countdown"
        />
      </FormRow>
      <Slider
        label="Countdown length"
        min={1}
        max={10}
        step={1}
        largeStep={1}
        formatValue={formatCountdownSeconds}
        value={recording.countdownSec}
        disabled={!recording.countdownEnabled}
        onChange={(countdownSec) => actions.updateSettings({ recording: { countdownSec } })}
        data-testid="settings-countdown-seconds"
      />
    </FormSection>
  );
}
