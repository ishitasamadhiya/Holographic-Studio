import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { FormRow, FormSection, Slider, Toggle } from '@renderer/ui';
import { describeMonitoringLatency, formatGainPercent } from '../settingsText';
import styles from './sections.module.css';

export function SoundSection() {
  const audio = useStudioState((state) => state.settings.audio);
  const latencyMs = useStudioState((state) => state.engine.monitoringLatencyMs);
  const actions = useStudioActions();

  return (
    <FormSection title="Sound" data-testid="settings-sound">
      <FormRow label="Hear my voice" hint="Your voice with its effects, in your headphones">
        <Toggle
          checked={audio.monitoringEnabled}
          onChange={(monitoringEnabled) => actions.updateSettings({ audio: { monitoringEnabled } })}
          data-testid="settings-monitoring"
        />
      </FormRow>
      <div className={styles.stack}>
        <Slider
          label="How loud you hear yourself"
          value={audio.monitorVolume}
          disabled={!audio.monitoringEnabled}
          onChange={(monitorVolume) => actions.updateSettings({ audio: { monitorVolume } })}
          data-testid="settings-monitor-volume"
        />
        <p className={styles.quiet} data-testid="settings-latency">
          {describeMonitoringLatency(latencyMs)}
        </p>
      </div>
      <Slider
        label="Backing track volume"
        value={audio.backingVolume}
        onChange={(backingVolume) => actions.updateSettings({ audio: { backingVolume } })}
        data-testid="settings-backing-volume"
      />
      <Slider
        label="Microphone level"
        min={0}
        max={2}
        step={0.05}
        unityValue={1}
        formatValue={formatGainPercent}
        value={audio.micGain}
        onChange={(micGain) => actions.updateSettings({ audio: { micGain } })}
        data-testid="settings-mic-gain"
      />
      <FormRow label="Light reverb" hint="A little room around your voice">
        <Toggle
          checked={audio.reverbEnabled}
          onChange={(reverbEnabled) => actions.updateSettings({ audio: { reverbEnabled } })}
          data-testid="settings-reverb"
        />
      </FormRow>
    </FormSection>
  );
}
