import { useStudioActions } from '@renderer/state/studioContext';
import { Button, CameraOffIcon, GlassPanel, MicrophoneIcon } from '@renderer/ui';
import { runAction } from '../runAction';
import type { ProblemAction, StudioProblem } from './problems';
import styles from './ProblemCard.module.css';

const ACTION_LABELS: Record<ProblemAction, string> = {
  'open-system-settings': 'Open System Settings',
  retry: 'Try Again',
  'switch-to-audio': 'Switch to Audio Only',
};

/** A calm card in the middle of the screen for the two things that stop a take: no sound, no camera. */
export function ProblemCard({ problem }: { problem: StudioProblem }) {
  const actions = useStudioActions();

  const perform = (action: ProblemAction) => {
    switch (action) {
      case 'open-system-settings':
        actions.openPermissionSettings(problem.source);
        break;
      case 'retry':
        runAction(problem.source === 'microphone' ? actions.startAudio() : actions.startCamera());
        break;
      case 'switch-to-audio':
        runAction(actions.setMode('audio'));
        break;
    }
  };

  return (
    <div className={styles.layer}>
      <GlassPanel
        variant="strong"
        radius="xl"
        padding="none"
        elevation="floating"
        role="alert"
        className={styles.card}
        data-testid="problem-card"
        data-source={problem.source}
      >
        <span className={styles.icon} aria-hidden="true">
          {problem.source === 'camera' ? <CameraOffIcon /> : <MicrophoneIcon />}
        </span>
        <h2 className={styles.title}>{problem.title}</h2>
        <p className={styles.message}>{problem.message}</p>
        <div className={styles.actions}>
          {problem.actions.map((action, index) => (
            <Button
              key={action}
              variant={index === 0 ? 'primary' : 'secondary'}
              fullWidth
              onClick={() => perform(action)}
              data-testid={`problem-action-${action}`}
            >
              {ACTION_LABELS[action]}
            </Button>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
