import { useState } from 'react';
import { VOCAL_VOLUME_UNITY } from '@shared/controls';
import { SUPPORTED_AUDIO_EXTENSIONS } from '@shared/ipc';
import {
  CameraIcon,
  Field,
  FileDropZone,
  type FileDropZoneState,
  FormRow,
  FormSection,
  GlassPanel,
  HandIcon,
  Kbd,
  MicrophoneIcon,
  SegmentedControl,
  Select,
  Slider,
  toastStore,
  Toggle,
  VolumeIcon,
} from '../index';
import { formatDecibels, LONG_FILE_NAME } from './samples';
import { Section, Stage } from './Section';
import styles from './InputsSection.module.css';

const SOURCE_OPTIONS = [
  { value: 'gesture', label: 'Gesture', icon: <HandIcon /> },
  { value: 'manual', label: 'Manual' },
] as const;
const MODE_OPTIONS = [
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio Only' },
] as const;
// No camera: the saved choice (Video) is unavailable, so the group's tab stop moves to Audio Only.
const NO_CAMERA_MODE_OPTIONS = [
  { value: 'video', label: 'Video', disabled: true },
  { value: 'audio', label: 'Audio Only' },
] as const;
const RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K', disabled: true },
] as const;
const MICROPHONES = [
  { value: 'builtin', label: 'MacBook Pro Microphone' },
  { value: 'scarlett', label: 'Scarlett Solo USB' },
];

interface DropExample {
  state: FileDropZoneState;
  fileName?: string;
  statusText?: string;
  'data-testid'?: string;
}

const DROP_EXAMPLES: readonly DropExample[] = [
  { state: 'loading', fileName: 'Midnight City.m4a', statusText: 'Analyzing reference vocal… 62%' },
  {
    state: 'ready',
    fileName: 'Midnight City (Instrumental).mp3',
    statusText: 'Backing track · 4:03',
  },
  {
    state: 'error',
    fileName: 'notes.txt',
    statusText: 'That file could not be opened. Try an MP3, WAV, or M4A file.',
  },
  {
    state: 'error',
    fileName: LONG_FILE_NAME,
    statusText: `“${LONG_FILE_NAME}” could not be read.`,
    'data-testid': 'demo-dropzone-long-name',
  },
];

export function InputsSection() {
  const [echo, setEcho] = useState(0.35);
  const [volume, setVolume] = useState(0.62);
  const [committedVolume, setCommittedVolume] = useState(0.62);
  const [source, setSource] = useState<'gesture' | 'manual'>('gesture');
  const [mode, setMode] = useState<'video' | 'audio'>('video');
  const [modeWithoutCamera, setModeWithoutCamera] = useState<'video' | 'audio'>('video');
  const [resolution, setResolution] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [monitoring, setMonitoring] = useState(true);
  const [microphone, setMicrophone] = useState<string | null>(null);
  const [droppedName, setDroppedName] = useState<string | null>(null);

  return (
    <Section
      id="inputs"
      title="Inputs"
      description="Controls for panels and sheets. All are keyboard operable: arrows, Home and End on sliders and segmented controls; Space on switches."
    >
      <Stage layout="grid">
        <GlassPanel variant="strong" padding="lg" className={styles.panel}>
          <h3 className={styles.panelTitle}>Slider</h3>
          <Slider label="Echo" value={echo} onChange={setEcho} data-testid="demo-slider" />
          <Slider
            label="Vocal volume"
            icon={<VolumeIcon />}
            value={volume}
            onChange={setVolume}
            onChangeEnd={setCommittedVolume}
            unityValue={VOCAL_VOLUME_UNITY}
            formatValue={formatDecibels}
            data-testid="demo-slider-unity"
          />
          <p className={styles.note} data-testid="demo-slider-committed">
            Last committed: {formatDecibels(committedVolume)}
          </p>
          <Slider label="Disabled" value={0.4} onChange={() => undefined} disabled />
          <FormRow label="In a form row">
            <div className={styles.rowSlider}>
              <Slider value={echo} onChange={setEcho} />
            </div>
          </FormRow>
        </GlassPanel>

        <GlassPanel variant="strong" padding="lg" className={styles.panel}>
          <h3 className={styles.panelTitle}>Segmented control and switch</h3>
          <SegmentedControl
            label="Control source"
            options={SOURCE_OPTIONS}
            value={source}
            onChange={setSource}
            data-testid="demo-segmented"
          />
          <SegmentedControl
            label="Recording mode"
            options={MODE_OPTIONS}
            value={mode}
            onChange={setMode}
            fullWidth
          />
          <SegmentedControl
            label="Recording mode without a camera"
            options={NO_CAMERA_MODE_OPTIONS}
            value={modeWithoutCamera}
            onChange={setModeWithoutCamera}
            fullWidth
            data-testid="demo-segmented-disabled-selection"
          />
          <SegmentedControl
            label="Resolution"
            size="sm"
            options={RESOLUTION_OPTIONS}
            value={resolution}
            onChange={setResolution}
          />
          <FormSection title="Form rows">
            <FormRow label="Hear my voice" hint="Your processed voice in the headphones">
              <Toggle checked={monitoring} onChange={setMonitoring} data-testid="demo-toggle" />
            </FormRow>
            <FormRow label="Reverb" hint="Unavailable while exporting">
              <Toggle checked={false} onChange={() => undefined} disabled />
            </FormRow>
          </FormSection>
        </GlassPanel>

        <GlassPanel variant="strong" padding="lg" className={styles.panel}>
          <h3 className={styles.panelTitle}>Select and fields</h3>
          <Field label="Microphone" hint="Pick the microphone you sing into.">
            <Select
              options={MICROPHONES}
              value={microphone}
              onChange={setMicrophone}
              placeholder="Choose a microphone…"
              icon={<MicrophoneIcon />}
              data-testid="demo-select"
            />
          </Field>
          <Field
            label="Camera"
            error="No camera was found. You can still record in Audio Only mode."
          >
            <Select
              options={[]}
              value={null}
              onChange={() => undefined}
              emptyLabel="No cameras found"
              icon={<CameraIcon />}
              data-testid="demo-select-empty"
            />
          </Field>
          <p className={styles.shortcuts}>
            <span>
              <Kbd>Space</Kbd> Record
            </span>
            <span>
              <Kbd>⌘</Kbd>
              <Kbd>,</Kbd> Settings
            </span>
            <span>
              <Kbd>Esc</Kbd> Close
            </span>
          </p>
        </GlassPanel>
      </Stage>

      <Stage layout="grid">
        <GlassPanel variant="strong" padding="lg" className={styles.panel}>
          <h3 className={styles.panelTitle}>File drop zone</h3>
          <FileDropZone
            label="Backing track"
            extensions={SUPPORTED_AUDIO_EXTENSIONS}
            state={droppedName ? 'ready' : 'empty'}
            fileName={droppedName}
            onBrowse={() => toastStore.show({ title: 'The app would open the file dialog here.' })}
            onFileDrop={(file) => setDroppedName(file.name)}
            onReject={(name) =>
              toastStore.show({ tone: 'error', title: `“${name}” is not an audio file.` })
            }
            onClear={() => setDroppedName(null)}
            data-testid="demo-dropzone"
          />
          <FileDropZone
            label="Disabled"
            extensions={['wav']}
            onBrowse={() => undefined}
            onFileDrop={() => undefined}
            disabled
          />
        </GlassPanel>
        <GlassPanel variant="strong" padding="lg" className={styles.panel}>
          <h3 className={styles.panelTitle}>File states</h3>
          {DROP_EXAMPLES.map((example) => (
            <FileDropZone
              key={example.fileName}
              label="Original song"
              extensions={SUPPORTED_AUDIO_EXTENSIONS}
              onBrowse={() => undefined}
              onFileDrop={() => undefined}
              onClear={() => undefined}
              {...example}
            />
          ))}
        </GlassPanel>
      </Stage>
    </Section>
  );
}
