import { useState } from 'react';
import type { ControlId, ControlSource } from '@shared/controls';
import type { RecordingMode } from '@shared/settings';
import {
  Button,
  CameraIcon,
  Field,
  FormRow,
  FormSection,
  HeadphonesIcon,
  MicrophoneIcon,
  SegmentedControl,
  Select,
  Sheet,
  Slider,
  Toggle,
} from '../index';
import styles from './SettingsSheetMock.module.css';

const MICROPHONES = [
  { value: 'builtin', label: 'MacBook Pro Microphone' },
  { value: 'scarlett', label: 'Scarlett Solo USB' },
  { value: 'airpods', label: 'AirPods Pro' },
];
const CAMERAS = [
  { value: 'facetime', label: 'FaceTime HD Camera' },
  { value: 'continuity', label: 'iPhone Camera' },
];
const OUTPUTS = [
  { value: 'headphones', label: 'External Headphones' },
  { value: 'speakers', label: 'MacBook Pro Speakers' },
];
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

export interface SettingsSheetMockProps {
  open: boolean;
  onClose: () => void;
}

/** The settings panel as it could look in the app, filled with pretend devices. */
export function SettingsSheetMock({ open, onClose }: SettingsSheetMockProps) {
  const [microphone, setMicrophone] = useState<string | null>('scarlett');
  const [camera, setCamera] = useState<string | null>('facetime');
  const [output, setOutput] = useState<string | null>('headphones');
  const [mode, setMode] = useState<RecordingMode>('video');
  const [monitoring, setMonitoring] = useState(true);
  const [monitorVolume, setMonitorVolume] = useState(0.8);
  const [backingVolume, setBackingVolume] = useState(0.7);
  const [reverb, setReverb] = useState(false);
  const [handControl, setHandControl] = useState(true);
  const [sources, setSources] = useState<Record<ControlId, ControlSource>>({
    autotune: 'gesture',
    volume: 'manual',
    echo: 'gesture',
  });
  const [countdown, setCountdown] = useState(true);
  const [vocalOffsetMs, setVocalOffsetMs] = useState(0);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Settings"
      description="Changes apply right away."
      data-testid="settings-sheet"
      footer={
        <>
          <Button variant="ghost">Reset to defaults</Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className={styles.sections}>
        <FormSection title="Devices">
          <Field label="Microphone">
            <Select
              options={MICROPHONES}
              value={microphone}
              onChange={setMicrophone}
              icon={<MicrophoneIcon />}
            />
          </Field>
          <Field label="Camera">
            <Select options={CAMERAS} value={camera} onChange={setCamera} icon={<CameraIcon />} />
          </Field>
          <Field
            label="Headphones"
            hint="Use headphones so the backing track stays out of the mic."
          >
            <Select
              options={OUTPUTS}
              value={output}
              onChange={setOutput}
              icon={<HeadphonesIcon />}
            />
          </Field>
        </FormSection>

        <FormSection title="Sound">
          <FormRow label="Hear my voice" hint="Your processed voice in the headphones">
            <Toggle
              checked={monitoring}
              onChange={setMonitoring}
              data-testid="settings-monitoring-toggle"
            />
          </FormRow>
          <Slider
            label="My voice in headphones"
            value={monitorVolume}
            onChange={setMonitorVolume}
            disabled={!monitoring}
          />
          <Slider label="Backing track" value={backingVolume} onChange={setBackingVolume} />
          <FormRow label="Reverb" hint="A light room sound on the vocal">
            <Toggle checked={reverb} onChange={setReverb} />
          </FormRow>
        </FormSection>

        <FormSection title="Hand control">
          <FormRow label="Control effects with my hands">
            <Toggle checked={handControl} onChange={setHandControl} />
          </FormRow>
          {CONTROL_ROWS.map((row) => (
            <FormRow key={row.id} label={row.label} hint={row.hint}>
              <SegmentedControl
                size="sm"
                options={SOURCE_OPTIONS}
                value={handControl ? sources[row.id] : 'manual'}
                onChange={(source) => setSources((current) => ({ ...current, [row.id]: source }))}
                disabled={!handControl}
              />
            </FormRow>
          ))}
        </FormSection>

        <FormSection title="Recording">
          <FormRow label="Mode">
            <SegmentedControl size="sm" options={MODE_OPTIONS} value={mode} onChange={setMode} />
          </FormRow>
          <FormRow label="Countdown" hint="Three seconds before recording starts">
            <Toggle checked={countdown} onChange={setCountdown} />
          </FormRow>
          <Slider
            label="Vocal timing"
            min={-200}
            max={200}
            step={5}
            unityValue={0}
            value={vocalOffsetMs}
            onChange={setVocalOffsetMs}
            formatValue={(value) => `${value > 0 ? '+' : ''}${value} ms`}
          />
        </FormSection>
      </div>
    </Sheet>
  );
}
