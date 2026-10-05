import { useEffect, useRef, useState } from 'react';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import type { RecordingState, RecordingStatus } from '@renderer/state/studioTypes';
import {
  Banner,
  Button,
  CheckIcon,
  FileIcon,
  FolderIcon,
  Modal,
  ProgressBar,
  TrashIcon,
  VisuallyHidden,
  WaveformIcon,
} from '@renderer/ui';
import { describeDuration } from '../studio/transport/formatTime';
import { exportStageLabel, fileNameFromPath } from './exportText';
import styles from './ExportFlow.module.css';

/** True from the moment a take is finished until it has been saved or discarded. */
export function isExportStatus(status: RecordingStatus): boolean {
  return status === 'review' || status === 'exporting' || status === 'saved';
}

type ExportView = 'review' | 'confirm-discard' | 'exporting' | 'saved';

function ignoreClose(): void {
  // Every step of the flow ends with an explicit choice; Escape and outside clicks do nothing.
}

function logFailure(error: unknown): void {
  console.error('An export action failed unexpectedly', error);
}

/**
 * What happens after a take: review it, save it as a video (with progress), and what to do
 * with the saved file. One dialog whose content follows the recording state, so moving from
 * step to step does not close and reopen anything.
 */
export function ExportFlow() {
  const recording = useStudioState((state) => state.recording);
  const actions = useStudioActions();
  const open = isExportStatus(recording.status);

  // While the dialog animates out the app is already idle again; keep showing the last step.
  const [shown, setShown] = useState<RecordingState>(recording);
  if (open && shown !== recording) setShown(recording);

  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  if (confirmingDiscard && shown.status !== 'review') setConfirmingDiscard(false);

  const view: ExportView =
    confirmingDiscard && shown.status === 'review'
      ? 'confirm-discard'
      : shown.status === 'exporting' || shown.status === 'saved'
        ? shown.status
        : 'review';

  // Each step puts keyboard focus on its main button. (When the dialog first opens, this
  // runs after the dialog has remembered where focus came from.)
  const mainButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) mainButtonRef.current?.focus({ preventScroll: true });
  }, [open, view]);

  const save = () => {
    actions.saveTake().catch(logFailure);
  };
  const discard = () => {
    actions.discardTake().catch(logFailure);
  };

  const common = {
    open,
    onClose: ignoreClose,
    dismissible: false,
    'data-testid': 'export-dialog',
    'data-view': view,
  } as const;

  if (view === 'confirm-discard') {
    return (
      <Modal
        {...common}
        role="alertdialog"
        icon={<TrashIcon />}
        title="Discard this take?"
        description="It will be deleted and cannot be brought back."
        actions={
          <>
            <Button
              ref={mainButtonRef}
              onClick={() => setConfirmingDiscard(false)}
              data-testid="export-keep"
            >
              Keep It
            </Button>
            <Button variant="danger" onClick={discard} data-testid="export-discard-confirm">
              Discard
            </Button>
          </>
        }
      />
    );
  }

  if (view === 'exporting') {
    const stageLabel = exportStageLabel(shown.exportStage);
    return (
      <Modal
        {...common}
        title="Saving your video"
        description="Keep Holographic Studio open until it is done."
        actions={
          <Button
            ref={mainButtonRef}
            onClick={() => actions.cancelExport()}
            data-testid="export-cancel"
          >
            Cancel
          </Button>
        }
      >
        <ProgressBar
          value={shown.exportProgress}
          label={stageLabel}
          showValue
          data-testid="export-progress"
        />
        {/* The stage is announced when it changes; the percentage is on the bar itself. */}
        <VisuallyHidden role="status" aria-live="polite">
          {stageLabel}
        </VisuallyHidden>
      </Modal>
    );
  }

  if (view === 'saved') {
    const fileName = shown.savedPath ? fileNameFromPath(shown.savedPath) : 'Your video';
    return (
      <Modal
        {...common}
        icon={<CheckIcon strokeWidth={2.25} />}
        title="Saved successfully"
        actions={
          <div className={styles.savedActions}>
            <Button
              iconStart={<FileIcon />}
              onClick={() => actions.openSavedFile()}
              data-testid="export-open-file"
            >
              Open File
            </Button>
            <Button
              iconStart={<FolderIcon />}
              onClick={() => actions.showSavedInFolder()}
              data-testid="export-show-in-folder"
            >
              Show in Folder
            </Button>
            <Button
              ref={mainButtonRef}
              variant="primary"
              onClick={() => actions.recordAnother()}
              data-testid="export-record-another"
            >
              Record Another Take
            </Button>
          </div>
        }
      >
        <p
          className={`${styles.fileName} selectable-text`}
          title={shown.savedPath ?? undefined}
          data-testid="export-file-name"
        >
          {fileName}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      {...common}
      icon={<WaveformIcon />}
      title="Your take is ready"
      description={
        <span data-testid="export-take-length">
          {describeDuration(shown.takeDurationSec)} long. Save it as a video with your voice and the
          backing track mixed together.
        </span>
      }
      actions={
        <>
          <Button onClick={() => setConfirmingDiscard(true)} data-testid="export-discard">
            Discard
          </Button>
          <Button ref={mainButtonRef} variant="primary" onClick={save} data-testid="export-save">
            {shown.error ? 'Try Again' : 'Save Video…'}
          </Button>
        </>
      }
    >
      {shown.error && (
        <Banner tone="error" className={styles.error} data-testid="export-error">
          {shown.error.message}
        </Banner>
      )}
    </Modal>
  );
}
