import { useEffect, useRef } from 'react';
import { FRIENDLY_ERROR_MESSAGES } from '@shared/errors';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { Banner, Button, FormRow, Slider, Toggle, WaveformIcon } from '@renderer/ui';
import { settle } from '../components/settle';
import { StepFrame } from '../components/StepFrame';
import styles from './steps.module.css';

export function MonitoringStep() {
  const actions = useStudioActions();
  const isMonitoring = useStudioState((state) => state.settings.audio.monitoringEnabled);
  const echo = useStudioState((state) => state.settings.controls.echo);
  const engineStatus = useStudioState((state) => state.engine.status);
  const engineError = useStudioState((state) => state.engine.error);

  // The echo slider here is only for trying an effect out. While the step is open it takes
  // the control over from the hand; on the way out the control goes back exactly as it was.
  const echoBefore = useRef(echo);
  useEffect(() => {
    const before = echoBefore.current;
    actions.updateSettings({ audio: { monitoringEnabled: true } });
    actions.setControlSource('echo', 'manual');
    return () => {
      actions.setControlSource('echo', before.source);
      actions.setManualControl('echo', before.manual);
    };
  }, [actions]);

  return (
    <StepFrame
      title="Hear yourself"
      lead="Sing a few notes: you should hear yourself in your headphones."
    >
      {engineStatus === 'error' && (
        <Banner
          tone="error"
          data-testid="wizard-monitoring-error"
          action={
            <Button size="sm" onClick={() => settle(actions.startAudio())}>
              Try again
            </Button>
          }
        >
          {engineError?.message ?? FRIENDLY_ERROR_MESSAGES['audio-engine-failed']}
        </Banner>
      )}

      <div className={styles.panel}>
        <FormRow label="Hear my voice" hint="Your own voice, live in your headphones">
          <Toggle
            checked={isMonitoring}
            onChange={(checked) =>
              actions.updateSettings({ audio: { monitoringEnabled: checked } })
            }
            data-testid="wizard-monitoring-toggle"
          />
        </FormRow>
        <div className={styles.panelDivider} />
        <div className={styles.stack}>
          <Slider
            label="Echo"
            icon={<WaveformIcon />}
            value={echo.manual}
            disabled={!isMonitoring}
            onChange={(value) => actions.setManualControl('echo', value)}
            data-testid="wizard-echo-slider"
          />
          <p className={styles.hint}>Slide it up and sing again to hear your voice echo.</p>
        </div>
      </div>

      <p className={styles.hint}>
        Can’t hear yourself? Check that the switch is on and your headphones are on.
      </p>
    </StepFrame>
  );
}
