import { FRIENDLY_ERROR_MESSAGES } from '@shared/errors';
import { useStudioState } from '@renderer/state/studioContext';
import { Banner, ProgressBar } from '@renderer/ui';
import { StatusNote } from '../components/StatusNote';
import { StepFrame } from '../components/StepFrame';
import styles from './steps.module.css';

const FOLLOWS_NEAREST_NOTE = 'Autotune will follow the nearest note instead.';

export function MelodyStep() {
  const reference = useStudioState((state) => state.reference);
  const isWorking = reference.status === 'loading' || reference.status === 'analyzing';

  return (
    <StepFrame
      title="Learning the melody"
      lead={
        isWorking
          ? 'This can take a minute. You can continue now: it keeps going in the background.'
          : 'This is what autotune will follow while you sing.'
      }
    >
      {isWorking && (
        <div className={styles.melody} data-testid="wizard-melody" data-status={reference.status}>
          {reference.file && <p className={styles.melodyFile}>{reference.file.name}</p>}
          <ProgressBar
            label="Analyzing reference vocal…"
            value={reference.status === 'analyzing' ? reference.progress : undefined}
            showValue
            data-testid="wizard-melody-progress"
          />
        </div>
      )}

      {reference.status === 'ready' && (
        <div className={styles.melody} data-testid="wizard-melody" data-status="ready">
          {reference.file && <p className={styles.melodyFile}>{reference.file.name}</p>}
          <StatusNote tone="success" data-testid="wizard-melody-status">
            Reference melody ready
          </StatusNote>
          {reference.keyLabel && (
            <p className={styles.hint} data-testid="wizard-melody-key">
              Song key: {reference.keyLabel}
            </p>
          )}
          {!reference.melodyUsable && (
            <p className={styles.note} data-testid="wizard-melody-key-only">
              The melody was hard to pick out in this song, so autotune will follow the song’s key
              instead. That still keeps you in tune.
            </p>
          )}
        </div>
      )}

      {reference.status === 'failed' && (
        <Banner tone="warning" data-testid="wizard-melody-failed">
          {reference.error?.message ?? FRIENDLY_ERROR_MESSAGES['analysis-failed']}
          {reference.error && reference.error.code !== 'analysis-failed'
            ? ` ${FOLLOWS_NEAREST_NOTE}`
            : ''}
        </Banner>
      )}
    </StepFrame>
  );
}
