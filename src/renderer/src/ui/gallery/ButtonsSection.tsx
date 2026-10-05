import { useEffect, useState } from 'react';
import {
  Button,
  CameraIcon,
  CameraOffIcon,
  ChevronRightIcon,
  FolderIcon,
  GlassPanel,
  HandIcon,
  IconButton,
  PauseIcon,
  RecordButton,
  RestartIcon,
  SettingsIcon,
  TrashIcon,
} from '../index';
import { Section, Specimen, Stage } from './Section';

/** Loops 3 → 2 → 1 so the countdown state can be watched without recording anything. */
function useLoopingCountdown(): number {
  const [value, setValue] = useState(3);
  useEffect(() => {
    const timer = window.setInterval(
      () => setValue((current) => (current > 1 ? current - 1 : 3)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return value;
}

export function ButtonsSection() {
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isSaving, setIsSaving] = useState(true);
  const countdown = useLoopingCountdown();

  return (
    <Section
      id="buttons"
      title="Buttons"
      description="Primary is plain white, secondary is glass, ghost is for panels, danger is a soft coral. The record button is the only saturated red on screen."
    >
      <Stage layout="row">
        <Specimen label="primary">
          <Button variant="primary" data-testid="button-primary">
            Save video
          </Button>
        </Specimen>
        <Specimen label="secondary">
          <Button data-testid="button-secondary">Choose…</Button>
        </Specimen>
        <Specimen label="danger">
          <Button variant="danger" data-testid="button-danger">
            Discard take
          </Button>
        </Specimen>
        <Specimen label="ghost (on a panel)">
          <GlassPanel variant="strong" padding="sm" style={{ display: 'flex', gap: 4 }}>
            <Button variant="ghost" data-testid="button-ghost">
              Back
            </Button>
            <Button variant="ghost" iconStart={<RestartIcon />}>
              Start over
            </Button>
          </GlassPanel>
        </Specimen>
        <Specimen label="sizes">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </Specimen>
        <Specimen label="with icons">
          <Button variant="primary" iconEnd={<ChevronRightIcon />}>
            Continue
          </Button>
          <Button iconStart={<FolderIcon />}>Show in Finder</Button>
        </Specimen>
        <Specimen label="loading (click to toggle)">
          <Button
            variant="primary"
            loading={isSaving}
            data-testid="button-loading"
            onClick={() => setIsSaving(true)}
          >
            Saving…
          </Button>
          <Button size="sm" onClick={() => setIsSaving((current) => !current)}>
            Toggle
          </Button>
        </Specimen>
        <Specimen label="disabled">
          <Button variant="primary" disabled>
            Continue
          </Button>
          <Button disabled>Choose…</Button>
        </Specimen>
      </Stage>

      <Stage layout="row">
        <Specimen label="glass · sm md lg">
          <IconButton label="Settings" size="sm">
            <SettingsIcon />
          </IconButton>
          <IconButton label="Settings">
            <SettingsIcon />
          </IconButton>
          <IconButton label="Settings" size="lg">
            <SettingsIcon />
          </IconButton>
        </Specimen>
        <Specimen label="pressed toggle">
          <IconButton
            label={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
            pressed={isCameraOn}
            onClick={() => setIsCameraOn((current) => !current)}
            data-testid="icon-button-toggle"
          >
            {isCameraOn ? <CameraIcon /> : <CameraOffIcon />}
          </IconButton>
          <IconButton label="Hand control" pressed>
            <HandIcon />
          </IconButton>
        </Specimen>
        <Specimen label="solid">
          <IconButton label="Pause" variant="solid">
            <PauseIcon />
          </IconButton>
        </Specimen>
        <Specimen label="ghost (on a panel)">
          <GlassPanel radius="pill" padding="none" style={{ display: 'flex', padding: 4 }}>
            <IconButton label="Pause" variant="ghost">
              <PauseIcon />
            </IconButton>
            <IconButton label="Start over" variant="ghost">
              <RestartIcon />
            </IconButton>
            <IconButton label="Delete take" variant="ghost" disabled>
              <TrashIcon />
            </IconButton>
          </GlassPanel>
        </Specimen>
      </Stage>

      <Stage layout="row">
        <Specimen label="idle">
          <RecordButton state="idle" data-testid="record-idle" />
        </Specimen>
        <Specimen label="countdown">
          <RecordButton
            state="countdown"
            countdownValue={countdown}
            data-testid="record-countdown"
          />
        </Specimen>
        <Specimen label="recording">
          <RecordButton state="recording" data-testid="record-recording" />
        </Specimen>
        <Specimen label="paused">
          <RecordButton state="paused" data-testid="record-paused" />
        </Specimen>
        <Specimen label="disabled">
          <RecordButton state="idle" disabled />
        </Specimen>
        <Specimen label="medium">
          <RecordButton state="idle" size="md" />
          <RecordButton state="recording" size="md" />
        </Specimen>
      </Stage>
      <Stage backdrop="white" layout="row">
        <Specimen label="on white: idle">
          <RecordButton state="idle" />
        </Specimen>
        <Specimen label="on white: recording">
          <RecordButton state="recording" />
        </Specimen>
        <Specimen label="on white: buttons">
          <Button variant="primary">Save video</Button>
          <Button data-testid="button-on-white">Choose…</Button>
          <Button variant="danger">Discard take</Button>
          <IconButton label="Settings">
            <SettingsIcon />
          </IconButton>
        </Specimen>
      </Stage>
    </Section>
  );
}
