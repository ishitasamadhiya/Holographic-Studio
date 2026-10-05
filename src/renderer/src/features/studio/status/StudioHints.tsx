import { useState } from 'react';
import { useStudioState } from '@renderer/state/studioContext';
import { Banner, Chip, HandIcon, HeadphonesIcon, StatusChip } from '@renderer/ui';
import styles from './StudioHints.module.css';

/**
 * The headphones reminder is shown once per run of the app: closing it keeps it away even
 * if the studio screen is left and entered again (for example after re-running the setup).
 */
let headphonesReminderDismissed = false;

export interface StudioHintsProps {
  /** Whether the screen is quiet enough for the reminder (idle, no problem, no toasts). */
  allowReminder: boolean;
  handsLost: boolean;
}

/** The few short messages that may appear over the preview, never more than one per spot. */
export function StudioHints({ allowReminder, handsLost }: StudioHintsProps) {
  const monitoring = useStudioState((state) => state.settings.audio.monitoringEnabled);
  const mode = useStudioState((state) => state.settings.mode);
  const trackingError = useStudioState((state) => state.tracking.error);
  const [reminderDismissed, setReminderDismissed] = useState(headphonesReminderDismissed);

  const dismissReminder = () => {
    headphonesReminderDismissed = true;
    setReminderDismissed(true);
  };

  const showTrackingNote = mode === 'video' && trackingError !== null;

  return (
    <>
      {allowReminder && monitoring && !reminderDismissed && (
        <Banner
          icon={<HeadphonesIcon />}
          title="Use headphones."
          onDismiss={dismissReminder}
          className={styles.reminder}
          data-testid="headphones-banner"
        >
          Without them, the microphone picks up the music and your own voice feeds back.
        </Banner>
      )}

      <div className={styles.hintSlot}>
        {showTrackingNote && (
          <StatusChip state="warning" title={trackingError.message} data-testid="tracking-note">
            Hand tracking is off — the sliders still work
          </StatusChip>
        )}
        {!showTrackingNote && handsLost && (
          <Chip
            icon={<HandIcon />}
            role="status"
            className={styles.handsHint}
            data-testid="hands-hint"
          >
            Show your hands to control the effects
          </Chip>
        )}
      </div>
    </>
  );
}
