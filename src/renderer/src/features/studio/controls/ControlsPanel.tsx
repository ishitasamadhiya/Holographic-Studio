import { useStudioState } from '@renderer/state/studioContext';
import { CloseIcon, cx, GlassPanel, IconButton, WarningIcon } from '@renderer/ui';
import { ControlRows } from './ControlRows';
import { KeyboardHints } from './KeyboardHints';
import styles from './ControlsPanel.module.css';

export interface ControlsPanelProps {
  id: string;
  /** Docked panels are part of the screen (Audio Only) and cannot be closed. */
  docked: boolean;
  onClose: () => void;
  className?: string;
}

/** The manual side of the three vocal controls, plus the keyboard shortcuts. */
export function ControlsPanel({ id, docked, onClose, className }: ControlsPanelProps) {
  const trackingError = useStudioState((state) => state.tracking.error);
  const mode = useStudioState((state) => state.settings.mode);

  return (
    <GlassPanel
      as="section"
      id={id}
      variant="strong"
      radius="xl"
      padding="none"
      elevation="floating"
      aria-label="Controls"
      className={cx(styles.panel, className)}
      data-docked={docked || undefined}
      data-testid="controls-panel"
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Controls</h2>
        {!docked && (
          <IconButton label="Close controls" variant="ghost" size="sm" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        )}
      </header>
      <div className={styles.body}>
        <ControlRows />
        {trackingError && mode === 'video' && (
          <p className={styles.trackingNote} role="status" data-testid="controls-tracking-note">
            <WarningIcon size={14} />
            <span>{trackingError.message}</span>
          </p>
        )}
        <KeyboardHints />
      </div>
    </GlassPanel>
  );
}
