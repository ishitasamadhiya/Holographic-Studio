import { useState } from 'react';
import { FRIENDLY_ERROR_MESSAGES } from '@shared/errors';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { Banner, Button } from '@renderer/ui';
import { MicLevel } from '../components/MicLevel';
import { settle } from '../components/settle';
import { StatusNote } from '../components/StatusNote';
import { StepFrame } from '../components/StepFrame';
import { chosenDeviceLabel } from '../logic/deviceChoices';
import { MicCheck, type MicCheckStatus } from '../logic/micCheck';
import styles from './steps.module.css';

export function MicTestStep() {
  const actions = useStudioActions();
  const engineStatus = useStudioState((state) => state.engine.status);
  const engineError = useStudioState((state) => state.engine.error);
  const microphones = useStudioState((state) => state.devices.microphones);
  const microphoneId = useStudioState((state) => state.settings.devices.microphoneId);

  const [check] = useState(() => new MicCheck());
  const [status, setStatus] = useState<MicCheckStatus>('listening');

  return (
    <StepFrame title="Test your microphone" lead="Say or sing something.">
      {engineStatus === 'error' && (
        <Banner
          tone="error"
          data-testid="wizard-mic-test-error"
          action={
            <Button size="sm" onClick={() => settle(actions.startAudio())}>
              Try again
            </Button>
          }
        >
          {engineError?.message ?? FRIENDLY_ERROR_MESSAGES['audio-engine-failed']}
        </Banner>
      )}

      <div className={styles.stack}>
        <MicLevel
          prominent
          data-testid="wizard-mic-test-meter"
          onFrame={(live) => setStatus(check.update(live.inputLevel, performance.now()))}
        />
        <p className={styles.hint} data-testid="wizard-mic-test-device">
          Microphone: {chosenDeviceLabel(microphones, microphoneId)}
        </p>
      </div>

      {status === 'heard' && (
        <StatusNote tone="success" data-testid="wizard-mic-test-status">
          We can hear you
        </StatusNote>
      )}
      {status === 'listening' && (
        <StatusNote tone="busy" data-testid="wizard-mic-test-status">
          Listening…
        </StatusNote>
      )}
      {status === 'silent' && (
        <StatusNote data-testid="wizard-mic-test-status">
          Nothing yet. If the bar does not move, go back and choose a different microphone.
        </StatusNote>
      )}
    </StepFrame>
  );
}
