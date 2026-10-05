import { type ReactNode, useRef, useState } from 'react';
import type { ControlStatus } from '@gestures/index';
import { CONTROL_IDS, type ControlId, type HandSide, VOCAL_VOLUME_UNITY } from '@shared/controls';
import { FRIENDLY_ERROR_MESSAGES } from '@shared/errors';
import { useLiveFrame, useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { isGestureControlled } from '@renderer/state/studioTypes';
import {
  Banner,
  Button,
  CheckIcon,
  Chip,
  ControlIndicator,
  type ControlIndicatorHandle,
  HandIcon,
  SparklesIcon,
  VisuallyHidden,
  VolumeIcon,
  WaveformIcon,
} from '@renderer/ui';
import { CameraPreview, useCameraWhileShown } from '../components/CameraPreview';
import { StepFrame } from '../components/StepFrame';
import { usePermission } from '../components/usePermission';
import {
  HAND_INSTRUCTIONS,
  handsAnnouncement,
  handsInView,
  indicatorStatus,
} from '../logic/handsView';
import styles from './steps.module.css';

const CONTROL_ICONS: Record<ControlId, ReactNode> = {
  autotune: <WaveformIcon />,
  volume: <VolumeIcon />,
  echo: <SparklesIcon />,
};

const HAND_SIDES: readonly HandSide[] = ['left', 'right'];
const HAND_NAMES: Record<HandSide, string> = { left: 'Left hand', right: 'Right hand' };

type CalibrationStage = 'idle' | 'measuring' | 'saved' | 'missed';

const CALIBRATION_MESSAGES: Record<CalibrationStage, string> = {
  idle: 'Hold your right hand at a comfortable distance, then press.',
  measuring: 'Hold still…',
  saved: 'Saved. That distance is now your normal volume.',
  missed: 'We could not see your right hand. Hold it up and try again.',
};

function sameStatuses(
  a: Record<ControlId, ControlStatus>,
  b: Record<ControlId, ControlStatus>,
): boolean {
  return CONTROL_IDS.every((control) => a[control] === b[control]);
}

export function HandsStep() {
  const actions = useStudioActions();
  const cameraPermission = usePermission('camera');
  const settings = useStudioState((state) => state.settings);
  const camera = useStudioState((state) => state.camera);
  const tracking = useStudioState((state) => state.tracking);

  const cameraAllowed = cameraPermission.view === 'allowed';
  useCameraWhileShown(cameraAllowed);

  const indicators = useRef<Partial<Record<ControlId, ControlIndicatorHandle | null>>>({});
  const [statuses, setStatuses] = useState<Record<ControlId, ControlStatus>>({
    autotune: 'manual',
    echo: 'manual',
    volume: 'manual',
  });
  const [inView, setInView] = useState<Record<HandSide, boolean>>({ left: false, right: false });
  const [calibration, setCalibration] = useState<CalibrationStage>('idle');

  useLiveFrame((live) => {
    for (const control of CONTROL_IDS) {
      indicators.current[control]?.setValue(live.controls[control]);
    }
    setStatuses((shown) =>
      sameStatuses(shown, live.controlStatus) ? shown : { ...live.controlStatus },
    );
    const hands = handsInView(live.gesture);
    setInView((shown) =>
      shown.left === hands.left && shown.right === hands.right ? shown : hands,
    );
  });

  const calibrate = () => {
    if (calibration === 'measuring') return;
    setCalibration('measuring');
    actions
      .calibrateHandDistance()
      .then((saved) => setCalibration(saved ? 'saved' : 'missed'))
      .catch(() => setCalibration('missed'));
  };

  const problem =
    camera.error?.message ??
    tracking.error?.message ??
    (cameraAllowed ? null : FRIENDLY_ERROR_MESSAGES['camera-permission-denied']);

  return (
    <StepFrame title="Try your hands" lead="Hold up your hands and watch the bars follow.">
      {problem !== null && (
        <Banner tone="warning" data-testid="wizard-hands-problem">
          {problem}
        </Banner>
      )}

      <div className={styles.handsRow}>
        <CameraPreview>
          <div className={styles.handChips} aria-hidden="true">
            {/* Mirrored like the picture: the singer's right hand is on the right. */}
            {HAND_SIDES.map((side) => (
              <Chip
                key={side}
                size="sm"
                tone={inView[side] ? 'success' : 'neutral'}
                icon={inView[side] ? <CheckIcon strokeWidth={2.25} /> : <HandIcon />}
                className={inView[side] ? undefined : styles.handChipWaiting}
                data-testid={`wizard-hand-${side}`}
                data-seen={inView[side]}
              >
                {HAND_NAMES[side]}
              </Chip>
            ))}
          </div>
          <VisuallyHidden role="status" aria-live="polite" data-testid="wizard-hands-seen">
            {handsAnnouncement(inView)}
          </VisuallyHidden>
        </CameraPreview>

        <div className={styles.indicators}>
          {HAND_INSTRUCTIONS.map(({ control, label }) => (
            <ControlIndicator
              key={control}
              ref={(handle) => {
                indicators.current[control] = handle;
              }}
              size="sm"
              label={label}
              icon={CONTROL_ICONS[control]}
              unityValue={control === 'volume' ? VOCAL_VOLUME_UNITY : undefined}
              status={indicatorStatus(
                statuses[control],
                isGestureControlled({ settings, camera, tracking }, control),
              )}
              data-testid={`wizard-indicator-${control}`}
            />
          ))}
        </div>
      </div>

      {/* With no hand tracking the gestures cannot be tried; the sliders take over. */}
      {problem === null && (
        <div className={styles.handsGuide}>
          <ul className={styles.instructions} data-testid="wizard-hand-instructions">
            {HAND_INSTRUCTIONS.map(({ control, label, instruction }) => (
              <li key={control} className={styles.instruction}>
                <strong>{label}</strong>
                <span>{instruction}</span>
              </li>
            ))}
          </ul>

          <div className={styles.calibration}>
            <Button
              loading={calibration === 'measuring'}
              onClick={calibrate}
              data-testid="wizard-calibrate"
            >
              Set my resting distance
            </Button>
            <p
              className={calibration === 'saved' ? styles.calibrationSaved : styles.hint}
              role="status"
              aria-live="polite"
              data-testid="wizard-calibrate-status"
            >
              {CALIBRATION_MESSAGES[calibration]}
            </p>
          </div>
        </div>
      )}
    </StepFrame>
  );
}
