import { useState } from 'react';
import { SUPPORTED_AUDIO_EXTENSIONS } from '@shared/ipc';
import {
  AppMark,
  Banner,
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileDropZone,
  GlassPanel,
  HeadphonesIcon,
  Kbd,
  Stepper,
  WaveformIcon,
} from '../index';
import styles from './WizardMock.module.css';

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'devices', label: 'Microphone and camera' },
  { id: 'song', label: 'Your song' },
  { id: 'hands', label: 'Hand controls' },
  { id: 'ready', label: 'Ready to record' },
];

/** One step of the first-run wizard ("Add your song"), assembled from design-system parts. */
export function WizardMock() {
  const [stepIndex, setStepIndex] = useState(2);

  return (
    <div className={styles.wizard} data-testid="wizard-mock">
      <div className={styles.aurora} aria-hidden="true" />
      <GlassPanel
        as="section"
        variant="strong"
        elevation="floating"
        radius="xl"
        padding="none"
        className={styles.card}
        data-testid="wizard-card"
      >
        <header className={styles.brand}>
          <AppMark size={28} />
          <span className={styles.brandName}>Holographic Studio</span>
          <span className={styles.stepCount}>
            Step {stepIndex + 1} of {STEPS.length}
          </span>
        </header>

        <div className={styles.intro}>
          <h2 className={styles.title}>Add your song</h2>
          <p className={styles.lead}>
            Choose the backing track you will sing over. Add the original song as well and autotune
            will follow its melody.
          </p>
        </div>

        <div className={styles.files}>
          <FileDropZone
            label="Backing track"
            extensions={SUPPORTED_AUDIO_EXTENSIONS}
            state="ready"
            fileName="Midnight City (Instrumental).mp3"
            statusText="Backing track · 4:03"
            onBrowse={() => undefined}
            onFileDrop={() => undefined}
            onClear={() => undefined}
            data-testid="wizard-backing-zone"
          />
          <FileDropZone
            label="Original song"
            extensions={SUPPORTED_AUDIO_EXTENSIONS}
            state="loading"
            fileName="Midnight City.m4a"
            statusText="Analyzing reference vocal… 62%"
            icon={<WaveformIcon />}
            onBrowse={() => undefined}
            onFileDrop={() => undefined}
            data-testid="wizard-reference-zone"
          />
        </div>

        <Banner tone="warning" icon={<HeadphonesIcon />} title="Use headphones.">
          They keep the backing track out of your microphone and prevent feedback.
        </Banner>

        <footer className={styles.footer}>
          <Button
            variant="ghost"
            iconStart={<ChevronLeftIcon />}
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
          >
            Back
          </Button>
          <Stepper steps={STEPS} currentIndex={stepIndex} data-testid="wizard-stepper" />
          <Button
            variant="primary"
            iconEnd={<ChevronRightIcon />}
            disabled={stepIndex === STEPS.length - 1}
            onClick={() => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1))}
            data-testid="wizard-continue"
          >
            Continue
          </Button>
        </footer>
      </GlassPanel>
      <p className={styles.shortcut}>
        <Kbd>⏎</Kbd> Continue
      </p>
    </div>
  );
}
