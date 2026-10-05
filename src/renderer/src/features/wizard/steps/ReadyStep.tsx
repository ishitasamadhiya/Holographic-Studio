import type { ReactNode } from 'react';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import {
  CameraIcon,
  HeadphonesIcon,
  MicrophoneIcon,
  MusicNoteIcon,
  RecordIcon,
  WaveformIcon,
} from '@renderer/ui';
import { StepFrame } from '../components/StepFrame';
import { setupSummary, type SummaryRow } from '../logic/setupSummary';
import styles from './steps.module.css';

const ROW_ICONS: Record<SummaryRow['id'], ReactNode> = {
  microphone: <MicrophoneIcon size={18} />,
  recording: <RecordIcon size={18} />,
  camera: <CameraIcon size={18} />,
  headphones: <HeadphonesIcon size={18} />,
  backing: <MusicNoteIcon size={18} />,
  reference: <WaveformIcon size={18} />,
};

export function ReadyStep() {
  const actions = useStudioActions();
  const settings = useStudioState((state) => state.settings);
  const devices = useStudioState((state) => state.devices);
  const backing = useStudioState((state) => state.backing);
  const reference = useStudioState((state) => state.reference);
  const rows = setupSummary({ settings, devices, backing, reference });

  return (
    <StepFrame
      title="You’re ready"
      lead="Here is your setup. You can change any of it later in Settings."
      primary={{ label: 'Enter Studio', onAction: () => actions.completeOnboarding() }}
    >
      <dl className={styles.summary} data-testid="wizard-summary">
        {rows.map((row) => (
          <div key={row.id} className={styles.summaryRow} data-row={row.id}>
            <dt className={styles.summaryLabel}>
              <span className={styles.summaryIcon} aria-hidden="true">
                {ROW_ICONS[row.id]}
              </span>
              {row.label}
            </dt>
            <dd className={styles.summaryValue}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </StepFrame>
  );
}
