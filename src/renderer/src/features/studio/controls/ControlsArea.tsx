import { useId } from 'react';
import { IconButton } from '@renderer/ui';
import { ControlsPanel } from './ControlsPanel';
import { SlidersIcon } from './SlidersIcon';
import styles from './ControlsArea.module.css';

export interface ControlsAreaProps {
  /** Audio Only: the sliders are the main control, so the panel stays open on the side. */
  docked: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The Controls panel and the compact button that shows it. Over the camera the panel floats
 * above the button in the bottom-right corner; in Audio Only it is docked open on the right.
 */
export function ControlsArea({ docked, open, onOpenChange }: ControlsAreaProps) {
  const panelId = useId();

  if (docked) {
    return (
      <ControlsPanel
        id={panelId}
        docked
        onClose={() => onOpenChange(false)}
        className={styles.docked}
      />
    );
  }

  return (
    <>
      {open && (
        <ControlsPanel
          id={panelId}
          docked={false}
          onClose={() => onOpenChange(false)}
          className={styles.floating}
        />
      )}
      <IconButton
        label={open ? 'Hide controls' : 'Show controls'}
        size="lg"
        pressed={open}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={styles.toggle}
        onClick={() => onOpenChange(!open)}
        data-testid="controls-button"
      >
        <SlidersIcon />
      </IconButton>
    </>
  );
}
