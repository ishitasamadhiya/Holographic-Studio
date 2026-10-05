import { useStudioState } from '@renderer/state/studioContext';
import type { RecordingStatus } from '@renderer/state/studioTypes';
import { Sheet } from '@renderer/ui';
import { AdvancedSection } from './sections/AdvancedSection';
import { DevicesSection } from './sections/DevicesSection';
import { HandControlSection } from './sections/HandControlSection';
import { RecordingSection } from './sections/RecordingSection';
import { SoundSection } from './sections/SoundSection';
import { VideoSection } from './sections/VideoSection';
import styles from './SettingsSheet.module.css';

export interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

/** From the countdown until the take is on disk, devices must not change under it. */
function isTakeRunning(status: RecordingStatus): boolean {
  return (
    status === 'countdown' ||
    status === 'recording' ||
    status === 'paused' ||
    status === 'finishing'
  );
}

function SettingsContent({ onClose }: { onClose: () => void }) {
  const locked = useStudioState((state) => isTakeRunning(state.recording.status));
  const version = useStudioState((state) => state.appInfo?.version ?? null);

  return (
    <div className={styles.sections}>
      {locked && (
        <p className={styles.lockNote} role="status" data-testid="settings-lock-note">
          Devices and video settings are locked while you record.
        </p>
      )}
      <DevicesSection locked={locked} />
      <VideoSection locked={locked} />
      <SoundSection />
      <HandControlSection locked={locked} />
      <RecordingSection />
      <AdvancedSection locked={locked} onClose={onClose} />
      {version && <p className={styles.version}>Holographic Studio {version}</p>}
    </div>
  );
}

/**
 * Settings, in a sheet from the right so the preview stays visible. Every change is applied
 * and stored at once; there is nothing to save.
 */
export function SettingsSheet({ open, onClose }: SettingsSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Settings"
      description="Changes apply right away."
      data-testid="settings-sheet"
    >
      <SettingsContent onClose={onClose} />
    </Sheet>
  );
}
