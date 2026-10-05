import { useState } from 'react';
import { CONTROL_IDS } from '@shared/controls';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { isGestureControlled } from '@renderer/state/studioTypes';
import { createToastStore } from '@renderer/ui';
import { ExportFlow, isExportStatus } from '../export';
import { SettingsSheet } from '../settings';
import { ControlsArea } from './controls/ControlsArea';
import { DropOverlay } from './drop/DropOverlay';
import { useBackingFileDrop } from './drop/useBackingFileDrop';
import { EdgeIndicators } from './indicators/EdgeIndicators';
import { useHandsLostHint } from './indicators/useHandsLostHint';
import { AudioStage } from './preview/AudioStage';
import { CameraPreview } from './preview/CameraPreview';
import { runAction } from './runAction';
import { runShortcut } from './shortcuts/runShortcut';
import { useStudioShortcuts } from './shortcuts/useStudioShortcuts';
import { NoticeToasts } from './status/NoticeToasts';
import { ProblemCard } from './status/ProblemCard';
import { canStartRecording, findStudioProblem } from './status/problems';
import { StudioHints } from './status/StudioHints';
import { TopBar } from './topbar/TopBar';
import { Countdown } from './transport/Countdown';
import { RecordBar } from './transport/RecordBar';
import styles from './StudioScreen.module.css';

export interface StudioScreenProps {
  /** Opens the Controls panel or the settings sheet straight away (developer previews). */
  initialOverlay?: 'controls' | 'settings';
}

/**
 * The main screen: the mirrored camera (or, in Audio Only, a calm stage) with a few floating
 * controls, plus the settings sheet, the export dialogs and the toast area.
 */
export function StudioScreen({ initialOverlay }: StudioScreenProps = {}) {
  const actions = useStudioActions();
  const mode = useStudioState((state) => state.settings.mode);
  const monitoringEnabled = useStudioState((state) => state.settings.audio.monitoringEnabled);
  const recordingStatus = useStudioState((state) => state.recording.status);
  const engine = useStudioState((state) => state.engine);
  const camera = useStudioState((state) => state.camera);
  const hasBackingTrack = useStudioState((state) => state.backing.status === 'ready');
  const hasNotices = useStudioState((state) => state.notices.length > 0);
  const anyGestureControl = useStudioState((state) =>
    CONTROL_IDS.some((id) => isGestureControlled(state, id)),
  );

  const [settingsOpen, setSettingsOpen] = useState(initialOverlay === 'settings');
  const [controlsOpen, setControlsOpen] = useState(initialOverlay === 'controls');
  const [discardPromptOpen, setDiscardPromptOpen] = useState(false);
  const [toasts] = useState(createToastStore);

  const isVideo = mode === 'video';
  const idle = recordingStatus === 'idle';
  const exportOpen = isExportStatus(recordingStatus);
  const dialogOpen = settingsOpen || exportOpen;
  const problem = findStudioProblem(engine, camera, mode);
  const canRecord = canStartRecording(engine, camera, mode);
  const handsLost = useHandsLostHint(isVideo && anyGestureControl && problem === null);

  const isDragging = useBackingFileDrop({
    enabled: idle && !dialogOpen,
    onAccept: (path) => runAction(actions.loadBackingTrack(path)),
    onReject: (message) => toasts.show({ title: message, tone: 'warning' }),
  });

  useStudioShortcuts(
    () => ({
      recordingStatus,
      canRecord,
      hasBackingTrack,
      dialogOpen,
      discardPromptOpen,
      // Docked in Audio Only, the panel is part of the screen and Escape leaves it alone.
      controlsPanelOpen: isVideo && controlsOpen,
    }),
    (command) =>
      runShortcut(command, actions, {
        monitoringEnabled,
        closeDiscardPrompt: () => setDiscardPromptOpen(false),
        closeControls: () => setControlsOpen(false),
        openSettings: () => setSettingsOpen(true),
      }),
  );

  return (
    <div
      className={styles.screen}
      data-testid="studio-screen"
      data-mode={mode}
      data-recording={recordingStatus}
    >
      {isVideo ? <CameraPreview /> : <AudioStage />}

      <TopBar idle={idle} onOpenSettings={() => setSettingsOpen(true)} />

      {isVideo && problem === null && <EdgeIndicators panelOpen={controlsOpen} />}

      <StudioHints allowReminder={idle && problem === null && !hasNotices} handsLost={handsLost} />

      <ControlsArea docked={!isVideo} open={controlsOpen} onOpenChange={setControlsOpen} />

      <RecordBar
        canRecord={canRecord}
        discardPromptOpen={discardPromptOpen}
        onDiscardPromptChange={setDiscardPromptOpen}
      />

      <Countdown />

      {problem && <ProblemCard problem={problem} />}
      {isDragging && <DropOverlay />}

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ExportFlow />
      <NoticeToasts store={toasts} shownElsewhere={problem?.message ?? null} />
    </div>
  );
}
