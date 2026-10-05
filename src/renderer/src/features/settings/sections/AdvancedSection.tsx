import { useId, useState } from 'react';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { Button, ChevronDownIcon, FormRow, FormSection, Slider, Toggle } from '@renderer/ui';
import { formatOffsetMs } from '../settingsText';
import styles from './sections.module.css';

/** How far the fine-tune sliders reach either way, in milliseconds. */
const SYNC_RANGE_MS = 300;
const SYNC_STEP_MS = 5;

export interface AdvancedSectionProps {
  locked: boolean;
  /** Closes the settings sheet (re-running the setup leaves the studio). */
  onClose: () => void;
}

/** Rarely needed settings, folded away so the sheet stays short. */
export function AdvancedSection({ locked, onClose }: AdvancedSectionProps) {
  const sync = useStudioState((state) => state.settings.sync);
  const showLandmarks = useStudioState((state) => state.settings.developer.showLandmarks);
  const actions = useStudioActions();
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  return (
    <div className={styles.advanced} data-testid="settings-advanced">
      <button
        type="button"
        className={styles.disclosure}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
        data-testid="settings-advanced-toggle"
      >
        Advanced
        <ChevronDownIcon size={16} />
      </button>

      {expanded && (
        <FormSection id={contentId} title="Fine-tuning">
          <div className={styles.stack}>
            <Slider
              label="Voice timing"
              min={-SYNC_RANGE_MS}
              max={SYNC_RANGE_MS}
              step={SYNC_STEP_MS}
              unityValue={0}
              formatValue={formatOffsetMs}
              value={sync.vocalOffsetMs}
              onChange={(vocalOffsetMs) => actions.updateSettings({ sync: { vocalOffsetMs } })}
              data-testid="settings-vocal-offset"
            />
            <p className={styles.quiet}>
              Moves your voice earlier (−) or later (+) against the music in saved videos.
            </p>
          </div>
          <div className={styles.stack}>
            <Slider
              label="Picture timing"
              min={-SYNC_RANGE_MS}
              max={SYNC_RANGE_MS}
              step={SYNC_STEP_MS}
              unityValue={0}
              formatValue={formatOffsetMs}
              value={sync.videoOffsetMs}
              onChange={(videoOffsetMs) => actions.updateSettings({ sync: { videoOffsetMs } })}
              data-testid="settings-video-offset"
            />
            <p className={styles.quiet}>
              Moves the picture earlier (−) or later (+) against the sound in saved videos.
            </p>
          </div>
          <FormRow label="Show hand landmarks" hint="Draws what the hand tracker sees">
            <Toggle
              checked={showLandmarks}
              onChange={(next) => actions.updateSettings({ developer: { showLandmarks: next } })}
              data-testid="settings-landmarks"
            />
          </FormRow>
          <FormRow label="Setup" hint="Go through the first-run steps again">
            <Button
              size="sm"
              disabled={locked}
              onClick={() => {
                onClose();
                actions.restartOnboarding();
              }}
              data-testid="settings-run-setup"
            >
              Run setup again
            </Button>
          </FormRow>
        </FormSection>
      )}
    </div>
  );
}
