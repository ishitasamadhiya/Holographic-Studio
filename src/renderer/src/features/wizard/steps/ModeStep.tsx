import { FRIENDLY_ERROR_MESSAGES } from '@shared/errors';
import type { RecordingMode } from '@shared/settings';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { Banner, Button, CameraIcon, Field, MicrophoneIcon, Select } from '@renderer/ui';
import { CameraPreview, useCameraWhileShown } from '../components/CameraPreview';
import { type ChoiceOption, ChoiceCards } from '../components/ChoiceCards';
import { settle } from '../components/settle';
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

const MODE_CHOICES: readonly ChoiceOption<RecordingMode>[] = [
  {
    value: 'video',
    title: 'Video',
    detail: 'Your hands shape your voice, on camera.',
    icon: <CameraIcon />,
  },
  {
    value: 'audio',
    title: 'Audio Only',
    detail: 'Just your voice, shaped with sliders.',
    icon: <MicrophoneIcon />,
  },
];

export function ModeStep() {
  const actions = useStudioActions();
  const { goNext } = useWizardNavigation();
  const permission = usePermission('camera');
  const mode = useStudioState((state) => state.settings.mode);
  const cameraStatus = useStudioState((state) => state.camera.status);
  const cameraError = useStudioState((state) => state.camera.error);
  const cameras = useStudioState((state) => state.devices.cameras);
  const cameraId = useStudioState((state) => state.settings.devices.cameraId);

  const wantsVideo = mode === 'video';
  const isAllowed = permission.view === 'allowed';
  const cameraFailed = cameraStatus === 'error';
  const cameraMissing = cameras.length === 0 && cameraStatus !== 'running';
  const cameraUsable = wantsVideo && isAllowed && !cameraFailed && !cameraMissing;
  useCameraWhileShown(cameraUsable);

  const switchToAudioOnly = () => settle(actions.setMode('audio'));

  let primary: StepAction | undefined;
  let secondary: StepAction | undefined;
  if (wantsVideo && permission.view === 'ask') {
    primary = { label: 'Allow camera', onAction: permission.ask, busy: permission.asking };
  } else if (wantsVideo && permission.view === 'blocked') {
    primary = { label: 'Open System Settings', onAction: permission.openSettings };
    secondary = { label: 'Use Audio Only', onAction: switchToAudioOnly };
  } else if (wantsVideo && !cameraUsable) {
    primary = {
      label: 'Continue with Audio Only',
      onAction: () => {
        switchToAudioOnly();
        goNext();
      },
    };
  }

  return (
    <StepFrame
      title="Camera or Audio Only"
      lead="Choose how you want to record. You can change this later."
      primary={primary}
      secondary={secondary}
    >
      <ChoiceCards
        label="How to record"
        options={MODE_CHOICES}
        value={mode}
        onChange={(next) => settle(actions.setMode(next))}
        data-testid="wizard-mode-choice"
      />

      {wantsVideo && permission.view === 'ask' && (
        <p className={styles.note}>
          Holographic Studio needs your camera to see your hands and to record your video.
        </p>
      )}

      {wantsVideo && permission.view === 'blocked' && (
        <Banner
          tone="error"
          data-testid="wizard-camera-blocked"
          action={
            <Button size="sm" loading={permission.asking} onClick={permission.ask}>
              Check again
            </Button>
          }
        >
          {blockedPermissionMessage('camera', cameraError)}
        </Banner>
      )}

      {wantsVideo && isAllowed && cameraFailed && (
        <Banner
          tone="error"
          data-testid="wizard-camera-error"
          action={
            <Button size="sm" onClick={() => settle(actions.startCamera())}>
              Try again
            </Button>
          }
        >
          {cameraError?.message ?? FRIENDLY_ERROR_MESSAGES['no-camera']}
        </Banner>
      )}

      {wantsVideo && isAllowed && !cameraFailed && cameraMissing && (
        <Banner
          tone="warning"
          data-testid="wizard-camera-empty"
          action={
            <Button size="sm" onClick={() => settle(actions.refreshDevices())}>
              Look again
            </Button>
          }
        >
          {FRIENDLY_ERROR_MESSAGES['no-camera']}
        </Banner>
      )}

      {cameraUsable && (
        <div className={styles.cameraRow}>
          <CameraPreview />
          <div className={styles.stack}>
            <Field label="Camera">
              <Select
                icon={<CameraIcon />}
                options={deviceSelectOptions(cameras)}
                value={selectValueForDevice(cameraId)}
                placeholder="Choose a camera…"
                onChange={(value) => settle(actions.selectCamera(deviceIdForSelectValue(value)))}
                data-testid="wizard-camera-select"
              />
            </Field>
            <p className={styles.hint}>
              You should see yourself, like in a mirror. Sit where both hands fit in the picture.
            </p>
          </div>
        </div>
      )}
    </StepFrame>
  );
}
