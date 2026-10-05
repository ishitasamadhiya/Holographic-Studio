import { useState } from 'react';
import type { ControlId, ControlSource } from '@shared/controls';
import type { RecordingMode } from '@shared/settings';
import {
  Button,
  CheckIcon,
  FolderIcon,
  FormRow,
  FormSection,
  GlassPanel,
  HandIcon,
  IconButton,
  Modal,
  ProgressBar,
  RestartIcon,
  SegmentedControl,
  SettingsIcon,
  Sheet,
  Stepper,
  Tooltip,
  TrashIcon,
} from '../index';
import { LONG_FILE_NAME } from './samples';
import { Section, Specimen, Stage } from './Section';
import { SettingsSheetMock } from './SettingsSheetMock';
import styles from './OverlaysSection.module.css';

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'devices', label: 'Microphone and camera' },
  { id: 'song', label: 'Your song' },
  { id: 'hands', label: 'Hand controls' },
  { id: 'ready', label: 'Ready to record' },
];

const TAKE_FILE_NAME = 'Holographic-Studio-Take-2026-10-05-2114.mp4';

const SOURCE_OPTIONS = [
  { value: 'gesture', label: 'Gesture' },
  { value: 'manual', label: 'Manual' },
] as const;
const MODE_OPTIONS = [
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio Only' },
] as const;
const CONTROL_ROWS: readonly { id: ControlId; label: string; hint: string }[] = [
  { id: 'autotune', label: 'Autotune', hint: 'Right hand · open and close' },
  { id: 'volume', label: 'Vocal volume', hint: 'Right hand · closer and farther' },
  { id: 'echo', label: 'Echo', hint: 'Left hand · open and close' },
];

export function OverlaysSection() {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isHandSheetOpen, setIsHandSheetOpen] = useState(false);
  const [isSavedOpen, setIsSavedOpen] = useState(false);
  const [savedFileName, setSavedFileName] = useState(TAKE_FILE_NAME);
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);
  const [isSaveOptionsOpen, setIsSaveOptionsOpen] = useState(false);
  const [isExportingOpen, setIsExportingOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(2);
  const [sources, setSources] = useState<Record<ControlId, ControlSource>>({
    autotune: 'gesture',
    volume: 'gesture',
    echo: 'gesture',
  });
  const [saveMode, setSaveMode] = useState<RecordingMode>('audio');

  return (
    <Section
      id="overlays"
      title="Overlays and progress"
      description="The settings sheet slides over from the right and keeps the video visible. Dialogs are for short decisions. Both trap focus and close with Esc."
    >
      <Stage layout="row">
        <Specimen label="sheets · with and without a footer">
          <Button
            iconStart={<SettingsIcon />}
            onClick={() => setIsSheetOpen(true)}
            data-testid="demo-open-sheet"
          >
            Open settings
          </Button>
          <Button
            iconStart={<HandIcon />}
            onClick={() => setIsHandSheetOpen(true)}
            data-testid="demo-open-hand-sheet"
          >
            Hand controls
          </Button>
        </Specimen>
        <Specimen label="dialogs">
          <Button
            onClick={() => {
              setSavedFileName(TAKE_FILE_NAME);
              setIsSavedOpen(true);
            }}
            data-testid="demo-open-saved"
          >
            Save succeeded
          </Button>
          <Button
            onClick={() => {
              setSavedFileName(LONG_FILE_NAME.replace(/\.mp3$/, '.mp4'));
              setIsSavedOpen(true);
            }}
            data-testid="demo-open-saved-long-name"
          >
            …with a long file name
          </Button>
          <Button onClick={() => setIsSaveOptionsOpen(true)} data-testid="demo-open-save-options">
            Save options…
          </Button>
          <Button onClick={() => setIsExportingOpen(true)} data-testid="demo-open-exporting">
            Exporting (no dismiss)
          </Button>
          <Button
            variant="danger"
            onClick={() => setIsDiscardOpen(true)}
            data-testid="demo-open-discard"
          >
            Discard take…
          </Button>
        </Specimen>
        <Specimen label="tooltips (hover or focus)">
          <Tooltip label="Start over">
            <IconButton label="Start over" data-testid="demo-tooltip-target">
              <RestartIcon />
            </IconButton>
          </Tooltip>
          <Tooltip label="Settings" placement="right">
            <IconButton label="Settings">
              <SettingsIcon />
            </IconButton>
          </Tooltip>
        </Specimen>
        <Specimen label="stepper · dots and bar">
          <GlassPanel variant="strong" className={styles.stepperPanel}>
            <Stepper steps={STEPS} currentIndex={stepIndex} data-testid="demo-stepper" />
            <Stepper steps={STEPS} currentIndex={stepIndex} variant="bar" />
            <div className={styles.stepperButtons}>
              <Button
                size="sm"
                variant="ghost"
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((index) => index - 1)}
              >
                Back
              </Button>
              <Button
                size="sm"
                disabled={stepIndex === STEPS.length - 1}
                onClick={() => setStepIndex((index) => index + 1)}
                data-testid="demo-stepper-next"
              >
                Next
              </Button>
            </div>
          </GlassPanel>
        </Specimen>
      </Stage>

      <SettingsSheetMock open={isSheetOpen} onClose={() => setIsSheetOpen(false)} />

      {/* No footer, and the last control is a radio group: the hardest case for the focus trap. */}
      <Sheet
        open={isHandSheetOpen}
        onClose={() => setIsHandSheetOpen(false)}
        title="Hand controls"
        description="Choose what your hands control."
        width={340}
        data-testid="hand-sheet"
      >
        <FormSection title="Effects">
          {CONTROL_ROWS.map((row) => (
            <FormRow key={row.id} label={row.label} hint={row.hint}>
              <SegmentedControl
                size="sm"
                options={SOURCE_OPTIONS}
                value={sources[row.id]}
                onChange={(source) => setSources((current) => ({ ...current, [row.id]: source }))}
              />
            </FormRow>
          ))}
        </FormSection>
      </Sheet>

      <Modal
        open={isSaveOptionsOpen}
        onClose={() => setIsSaveOptionsOpen(false)}
        title="Save this take"
        description="Choose what goes into the file."
        data-testid="save-options-dialog"
        actions={
          <>
            <Button onClick={() => setIsSaveOptionsOpen(false)}>Cancel</Button>
            <Button variant="primary" data-autofocus onClick={() => setIsSaveOptionsOpen(false)}>
              Save
            </Button>
          </>
        }
      >
        <SegmentedControl
          label="What to save"
          options={MODE_OPTIONS}
          value={saveMode}
          onChange={setSaveMode}
          fullWidth
        />
      </Modal>

      <Modal
        open={isSavedOpen}
        onClose={() => setIsSavedOpen(false)}
        icon={<CheckIcon />}
        title="Your video is saved"
        description={`${savedFileName} is in your Movies folder.`}
        data-testid="saved-dialog"
        actions={
          <>
            <Button iconStart={<FolderIcon />} onClick={() => setIsSavedOpen(false)}>
              Show in Finder
            </Button>
            <Button variant="primary" data-autofocus onClick={() => setIsSavedOpen(false)}>
              Done
            </Button>
          </>
        }
      />

      {/* Escape and outside clicks do nothing: only Cancel ends it. */}
      <Modal
        open={isExportingOpen}
        onClose={() => setIsExportingOpen(false)}
        dismissible={false}
        title="Saving your video"
        description="This takes a moment. Keep the app open."
        data-testid="exporting-dialog"
        actions={
          <Button data-autofocus onClick={() => setIsExportingOpen(false)}>
            Cancel
          </Button>
        }
      >
        <ProgressBar label="Saving your video" hideLabel />
      </Modal>

      <Modal
        open={isDiscardOpen}
        onClose={() => setIsDiscardOpen(false)}
        role="alertdialog"
        icon={<TrashIcon />}
        title="Discard this take?"
        description="The recording will be deleted. This cannot be undone."
        data-testid="discard-dialog"
        actions={
          <>
            <Button data-autofocus onClick={() => setIsDiscardOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => setIsDiscardOpen(false)}>
              Discard
            </Button>
          </>
        }
      />
    </Section>
  );
}
