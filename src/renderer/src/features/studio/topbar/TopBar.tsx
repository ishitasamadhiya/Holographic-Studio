import type { RecordingMode } from '@shared/settings';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import {
  CheckIcon,
  GlassPanel,
  IconButton,
  MusicNoteIcon,
  PlayIcon,
  SegmentedControl,
  SettingsIcon,
  StopIcon,
  WaveformIcon,
} from '@renderer/ui';
import { runAction } from '../runAction';
import { SongChip, SongChipButton } from './SongChip';
import { describeBackingChip, describeReferenceChip } from './songLabels';
import styles from './TopBar.module.css';

const MODE_OPTIONS = [
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio Only' },
] as const satisfies readonly { value: RecordingMode; label: string }[];

export interface TopBarProps {
  /** False from the countdown until the take has been saved or discarded. */
  idle: boolean;
  onOpenSettings: () => void;
}

/**
 * The strip along the top of the window. It is what moves the frameless window when
 * dragged; everything interactive on it opts out of dragging (see global.css).
 */
export function TopBar({ idle, onOpenSettings }: TopBarProps) {
  const backing = useStudioState((state) => state.backing);
  const reference = useStudioState((state) => state.reference);
  const previewPlaying = useStudioState((state) => state.previewPlaying);
  const mode = useStudioState((state) => state.settings.mode);
  const actions = useStudioActions();

  const referenceView = describeReferenceChip(reference);

  return (
    <header className={`${styles.bar} app-drag`} data-testid="studio-top-bar">
      <div className={styles.songs}>
        <SongChip
          view={describeBackingChip(backing)}
          icon={<MusicNoteIcon />}
          onChoose={idle ? () => runAction(actions.chooseBackingTrack()) : undefined}
          onRemove={idle ? () => actions.clearBackingTrack() : undefined}
          removeLabel="Remove backing track"
          trailing={
            idle && (
              <SongChipButton
                label={previewPlaying ? 'Stop preview' : 'Preview backing track'}
                pressed={previewPlaying}
                onClick={() => actions.togglePreviewPlayback()}
                data-testid="backing-preview-button"
              >
                {previewPlaying ? <StopIcon /> : <PlayIcon />}
              </SongChipButton>
            )
          }
          data-testid="backing-chip"
        />
        <SongChip
          view={referenceView}
          icon={
            referenceView.kind === 'ready' ? <CheckIcon strokeWidth={2.25} /> : <WaveformIcon />
          }
          onChoose={idle ? () => runAction(actions.chooseReferenceSong()) : undefined}
          onRemove={idle ? () => actions.clearReferenceSong() : undefined}
          removeLabel="Remove original song"
          data-testid="reference-chip"
        />
      </div>

      <div className={styles.end}>
        <GlassPanel
          radius="pill"
          padding="none"
          elevation="flat"
          className={styles.modeSwitch}
          title={idle ? undefined : 'Finish this take to change the mode'}
        >
          <SegmentedControl
            size="sm"
            label="Recording mode"
            options={MODE_OPTIONS}
            value={mode}
            disabled={!idle}
            onChange={(next) => runAction(actions.setMode(next))}
            data-testid="mode-switch"
          />
        </GlassPanel>
        <IconButton label="Settings" onClick={onOpenSettings} data-testid="studio-settings-button">
          <SettingsIcon />
        </IconButton>
      </div>
    </header>
  );
}
