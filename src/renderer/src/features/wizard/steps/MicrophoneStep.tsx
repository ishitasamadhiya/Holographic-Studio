import { useEffect } from 'react';
import { FRIENDLY_ERROR_MESSAGES } from '@shared/errors';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { Banner, Button, Field, MicrophoneIcon, Select } from '@renderer/ui';
import { MicLevel } from '../components/MicLevel';
import { settle } from '../components/settle';
import { StatusNote } from '../components/StatusNote';
import { type StepAction, StepFrame } from '../components/StepFrame';
import { usePermission } from '../components/usePermission';
import { useWizardNavigation } from '../components/wizardNavigation';
import {
  deviceIdForSelectValue,
  deviceSelectOptions,
  selectValueForDevice,
} from '../logic/deviceChoices';
import { blockedPermissionMessage } from '../logic/permissionView';
import styles from './steps.module.css';

export function MicrophoneStep() {
  const actions = useStudioActions();
  const { goNext } = useWizardNavigation();
  const permission = usePermission('microphone');
  const engineStatus = useStudioState((state) => state.engine.status);
  const engineError = useStudioState((state) => state.engine.error);
  const microphones = useStudioState((state) => state.devices.microphones);
  const microphoneId = useStudioState((state) => state.settings.devices.microphoneId);

  const isAllowed = permission.view === 'allowed';
  useEffect(() => {
    if (!isAllowed || engineStatus !== 'off') return;
    // The microphone is about to open and the singer has not been told to put headphones
    // on yet: their voice must not come out of the speakers, where it would feed back.
    // The "Hear yourself" step turns monitoring on.
    actions.updateSettings({ audio: { monitoringEnabled: false } });
    settle(actions.startAudio());
  }, [isAllowed, engineStatus, actions]);

  const notNow: StepAction = { label: 'Not now', onAction: goNext };

  if (permission.view === 'ask') {
    return (
      <StepFrame
        title="Choose your microphone"
        lead="Holographic Studio needs your microphone to hear you sing."
        primary={{ label: 'Allow microphone', onAction: permission.ask, busy: permission.asking }}
        secondary={notNow}
      >
        <p className={styles.note}>
          Your computer will ask for permission. Nothing is recorded until you press record.
        </p>
      </StepFrame>
    );
  }

  if (permission.view === 'blocked') {
    return (
      <StepFrame
        title="Choose your microphone"
        lead="Holographic Studio needs your microphone to hear you sing."
        primary={{ label: 'Open System Settings', onAction: permission.openSettings }}
        secondary={notNow}
      >
        <Banner
          tone="error"
          data-testid="wizard-microphone-blocked"
          action={
            <Button size="sm" loading={permission.asking} onClick={permission.ask}>
              Check again
            </Button>
          }
        >
          {blockedPermissionMessage('microphone', engineError)}
        </Banner>
      </StepFrame>
    );
  }

  const hasMicrophones = microphones.length > 0;
  return (
    <StepFrame
      title="Choose your microphone"
      lead="Pick the microphone you will sing into, then say something to see it react."
    >
      {engineStatus === 'error' && (
        <Banner
          tone="error"
          data-testid="wizard-microphone-error"
          action={
            <Button size="sm" onClick={() => settle(actions.startAudio())}>
              Try again
            </Button>
          }
        >
          {engineError?.message ?? FRIENDLY_ERROR_MESSAGES['audio-engine-failed']}
        </Banner>
      )}

      {hasMicrophones ? (
        <>
          <Field label="Microphone">
            <Select
              icon={<MicrophoneIcon />}
              options={deviceSelectOptions(microphones)}
              value={selectValueForDevice(microphoneId)}
              placeholder="Choose a microphone…"
              onChange={(value) => settle(actions.selectMicrophone(deviceIdForSelectValue(value)))}
              data-testid="wizard-microphone-select"
            />
          </Field>
          <div className={styles.stack}>
            <MicLevel data-testid="wizard-microphone-meter" />
            {engineStatus === 'starting' ? (
              <StatusNote tone="busy">Getting your microphone ready…</StatusNote>
            ) : (
              <p className={styles.hint}>The bar moves when the microphone picks up your voice.</p>
            )}
          </div>
        </>
      ) : (
        engineStatus !== 'error' && (
          <Banner
            tone="warning"
            data-testid="wizard-microphone-empty"
            action={
              <Button size="sm" onClick={() => settle(actions.refreshDevices())}>
                Look again
              </Button>
            }
          >
            {FRIENDLY_ERROR_MESSAGES['no-microphone']}
          </Banner>
        )
      )}
    </StepFrame>
  );
}
