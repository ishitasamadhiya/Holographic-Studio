import { useStudioState } from '@renderer/state/studioContext';
import styles from './Countdown.module.css';

/** The count-in before a take: one large, quiet number in the middle of the screen. */
export function Countdown() {
  const status = useStudioState((state) => state.recording.status);
  const remaining = useStudioState((state) => state.recording.countdownRemaining);
  if (status !== 'countdown') return null;

  return (
    <div
      className={styles.countdown}
      role="timer"
      aria-live="assertive"
      aria-atomic="true"
      aria-label={`Recording starts in ${remaining}`}
      data-testid="countdown"
    >
      {/* Keyed by the number so every tick replays the entrance. */}
      <span key={remaining} className={styles.number} aria-hidden="true">
        {remaining}
      </span>
    </div>
  );
}
