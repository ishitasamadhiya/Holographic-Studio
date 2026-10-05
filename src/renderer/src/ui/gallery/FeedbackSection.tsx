import { useEffect, useState } from 'react';
import { FRIENDLY_ERROR_MESSAGES } from '@shared/errors';
import {
  Banner,
  Button,
  CameraIcon,
  Chip,
  GlassPanel,
  HeadphonesIcon,
  MusicNoteIcon,
  ProgressBar,
  ProgressRing,
  Spinner,
  StatusChip,
  Toast,
  toastStore,
} from '../index';
import { Section, Specimen, Stage } from './Section';
import styles from './FeedbackSection.module.css';

/** Climbs from 0 to 1 and starts over, to show determinate progress in motion. */
function useLoopingProgress(): number {
  const [progress, setProgress] = useState(0.62);
  useEffect(() => {
    const timer = window.setInterval(
      () => setProgress((current) => (current >= 1 ? 0 : Math.min(1, current + 0.02))),
      180,
    );
    return () => window.clearInterval(timer);
  }, []);
  return progress;
}

/** A save that keeps failing: every retry reports again under the same toast id. */
function showSaveFailure(attempt: number): void {
  toastStore.show({
    id: 'save-failed',
    tone: 'error',
    title: attempt === 1 ? 'The video could not be saved' : `Still not saved (try ${attempt})`,
    description: FRIENDLY_ERROR_MESSAGES['export-failed'],
    action: { label: 'Try again', onAction: () => showSaveFailure(attempt + 1) },
  });
}

export function FeedbackSection() {
  const progress = useLoopingProgress();
  const [isBannerVisible, setIsBannerVisible] = useState(true);

  return (
    <Section
      id="feedback"
      title="Status and feedback"
      description="Chips state facts, banners stay until resolved, toasts come and go. Tone only ever colours the icon; the text stays white."
    >
      <Stage layout="row">
        <Specimen label="chips">
          <Chip icon={<MusicNoteIcon />}>Midnight City</Chip>
          <Chip>A♭ major</Chip>
          <Chip tone="recording" dot data-testid="chip-recording">
            REC 01:24
          </Chip>
          <Chip size="sm" icon={<CameraIcon />}>
            1080p
          </Chip>
        </Specimen>
        <Specimen label="status chips">
          <StatusChip state="busy" data-testid="status-chip-busy">
            Analyzing reference vocal…
          </StatusChip>
          <StatusChip state="busy" progress={progress}>
            Analyzing… {Math.round(progress * 100)}%
          </StatusChip>
          <StatusChip state="ready" data-testid="status-chip-ready">
            Reference melody ready
          </StatusChip>
        </Specimen>
        <Specimen label="more states">
          <StatusChip state="info">Following the song key</StatusChip>
          <StatusChip state="warning">Hand not visible</StatusChip>
          <StatusChip state="error">Microphone disconnected</StatusChip>
        </Specimen>
      </Stage>

      <Stage backdrop="white" layout="row">
        <Specimen label="on white">
          <Chip icon={<MusicNoteIcon />}>Midnight City</Chip>
          <StatusChip state="ready">Reference melody ready</StatusChip>
          <StatusChip state="busy">Analyzing reference vocal…</StatusChip>
          <StatusChip state="warning">Hand not visible</StatusChip>
          <Chip tone="recording" dot>
            REC 01:24
          </Chip>
        </Specimen>
      </Stage>

      <Stage layout="grid">
        <GlassPanel variant="strong" padding="lg" className={styles.panel}>
          <ProgressBar
            label="Saving your video"
            value={progress}
            showValue
            data-testid="demo-progress"
          />
          <ProgressBar label="Preparing…" />
          <ProgressBar label="Mixing audio" value={0.3} size="sm" hideLabel />
          <div className={styles.rings}>
            <ProgressRing label="Saving your video" value={progress} size={56} strokeWidth={4}>
              {Math.round(progress * 100)}
            </ProgressRing>
            <ProgressRing label="Analyzing" size={40} />
            <ProgressRing label="Analyzing" value={0.75} size={24} strokeWidth={3} />
            <span className={styles.spinners}>
              <Spinner size="sm" />
              <Spinner size="md" />
              <Spinner size="lg" />
            </span>
          </div>
        </GlassPanel>

        <div className={styles.banners}>
          <Banner
            tone="warning"
            icon={<HeadphonesIcon />}
            title="Use headphones."
            data-testid="demo-banner"
          >
            They keep the backing track out of your microphone and prevent feedback.
          </Banner>
          <Banner tone="info">Without a reference song, autotune follows the nearest note.</Banner>
          <Banner
            tone="error"
            action={
              <Button size="sm" variant="secondary">
                Open Settings
              </Button>
            }
          >
            {FRIENDLY_ERROR_MESSAGES['camera-permission-denied']}
          </Banner>
          {isBannerVisible ? (
            <Banner tone="success" onDismiss={() => setIsBannerVisible(false)}>
              Hand tracking is calibrated to your resting distance.
            </Banner>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setIsBannerVisible(true)}>
              Show the dismissed banner again
            </Button>
          )}
        </div>
      </Stage>

      <Stage layout="grid">
        <div className={styles.toasts}>
          <Toast
            toast={{
              id: 'static-success',
              tone: 'success',
              title: 'Video saved',
              durationMs: null,
            }}
            onDismiss={() => undefined}
          />
          <Toast
            toast={{
              id: 'static-warning',
              tone: 'warning',
              title: 'Microphone disconnected',
              description: 'Reconnect it or pick a different one in Settings.',
              action: { label: 'Settings', onAction: () => undefined },
              durationMs: null,
            }}
            onDismiss={() => undefined}
          />
          <Toast
            toast={{
              id: 'static-error',
              tone: 'error',
              title: 'The video could not be saved',
              description: 'Your take is still here — try saving again.',
              action: { label: 'Try again', onAction: () => undefined },
              durationMs: null,
            }}
            onDismiss={() => undefined}
          />
        </div>
        <GlassPanel variant="strong" padding="lg" className={styles.panel}>
          <p className={styles.note}>Live toasts appear at the top of the window.</p>
          <div className={styles.toastButtons}>
            <Button
              data-testid="demo-toast-success"
              onClick={() =>
                toastStore.show({
                  tone: 'success',
                  title: 'Video saved',
                  description: 'Holographic-Studio-Take-2026-10-05-2114.mp4',
                })
              }
            >
              Success
            </Button>
            <Button
              data-testid="demo-toast-warning"
              onClick={() =>
                toastStore.show({
                  id: 'device',
                  tone: 'warning',
                  title: 'Microphone disconnected',
                  description: FRIENDLY_ERROR_MESSAGES['device-disconnected'],
                  action: {
                    label: 'Settings',
                    onAction: () => toastStore.show({ title: 'The app would open Settings here.' }),
                  },
                })
              }
            >
              Warning with action
            </Button>
            <Button
              data-testid="demo-toast-error"
              onClick={() =>
                toastStore.show({
                  tone: 'error',
                  title: 'Hand tracking stopped',
                  description: FRIENDLY_ERROR_MESSAGES['hand-tracking-failed'],
                  durationMs: null,
                })
              }
            >
              Sticky error
            </Button>
            <Button data-testid="demo-toast-retry" onClick={() => showSaveFailure(1)}>
              Error with retry
            </Button>
            <Button variant="ghost" onClick={() => toastStore.clear()}>
              Clear
            </Button>
          </div>
        </GlassPanel>
      </Stage>
    </Section>
  );
}
