import { useEffect, useRef, useState } from 'react';
import { VOCAL_VOLUME_UNITY } from '@shared/controls';
import {
  Chip,
  ControlIndicator,
  type ControlIndicatorHandle,
  cx,
  GlassPanel,
  HandIcon,
  IconButton,
  LevelMeter,
  type LevelMeterHandle,
  MicrophoneIcon,
  MusicNoteIcon,
  PauseIcon,
  PlayIcon,
  RecordButton,
  type RecordButtonState,
  RestartIcon,
  SettingsIcon,
  SparklesIcon,
  StatusChip,
  Tooltip,
  VolumeIcon,
  WaveformIcon,
} from '../index';
import { formatClock, useMockRecorder } from './mockRecorder';
import { SettingsSheetMock } from './SettingsSheetMock';
import { WebcamBackdrop } from './WebcamBackdrop';
import styles from './StudioMock.module.css';

export interface StudioMockProps {
  /** Draws pretend traffic lights (for the framed preview; the real window has real ones). */
  showWindowChrome?: boolean;
  initialPhase?: RecordButtonState;
  /** Opens the settings sheet straight away. */
  settingsInitiallyOpen?: boolean;
  className?: string;
}

/**
 * The studio screen assembled from design-system parts over a pretend webcam picture:
 * status chips along the top, live control indicators at the edges, the transport at the
 * bottom. Values move on their own to stand in for a performer's hands.
 */
export function StudioMock({
  showWindowChrome = false,
  initialPhase = 'recording',
  settingsInitiallyOpen = false,
  className,
}: StudioMockProps) {
  const recorder = useMockRecorder({ phase: initialPhase, countdown: 3, elapsedSec: 84 });
  const [handControl, setHandControl] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(settingsInitiallyOpen);

  const autotuneRef = useRef<ControlIndicatorHandle>(null);
  const echoRef = useRef<ControlIndicatorHandle>(null);
  const meterRef = useRef<LevelMeterHandle>(null);

  // Stand-in for live data: slow hand movement and a voice-like level, pushed through the
  // imperative handles exactly as the real gesture and audio layers will do.
  useEffect(() => {
    let frame = 0;
    const animate = (timeMs: number) => {
      if (handControl) {
        autotuneRef.current?.setValue(0.66 + 0.22 * Math.sin(timeMs / 1900));
        echoRef.current?.setValue(0.34 + 0.2 * Math.sin(timeMs / 2600 + 1.3));
      }
      const syllable = Math.abs(Math.sin(timeMs / 210)) * (0.6 + 0.4 * Math.sin(timeMs / 1700));
      meterRef.current?.setLevel(0.28 + 0.5 * syllable);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [handControl]);

  const isTakeActive = recorder.phase === 'recording' || recorder.phase === 'paused';
  const gestureStatus = handControl ? 'gesture-live' : 'manual';

  return (
    <div className={cx(styles.studio, className)} data-testid="studio-mock">
      <WebcamBackdrop className={styles.backdrop} />

      {/* Only the full-window mock should move the real window when its top bar is dragged. */}
      <header
        className={cx(styles.topBar, !showWindowChrome && 'app-drag')}
        data-testid="studio-top-bar"
      >
        <div className={styles.topStart}>
          {showWindowChrome && (
            <span className={styles.trafficLights} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
          <Chip icon={<MusicNoteIcon />}>Midnight City (Instrumental)</Chip>
        </div>
        <div className={styles.topCenter}>
          <StatusChip state="ready" data-testid="studio-melody-chip">
            Reference melody ready
          </StatusChip>
          <Chip>A♭ major</Chip>
        </div>
        <div className={styles.topEnd}>
          <Tooltip
            label={handControl ? 'Hand control is on' : 'Hand control is off'}
            placement="bottom"
          >
            <IconButton
              label="Hand control"
              pressed={handControl}
              onClick={() => setHandControl((current) => !current)}
              data-testid="studio-hand-toggle"
            >
              <HandIcon />
            </IconButton>
          </Tooltip>
          <IconButton
            label="Settings"
            onClick={() => setIsSettingsOpen(true)}
            data-testid="studio-settings-button"
          >
            <SettingsIcon />
          </IconButton>
        </div>
      </header>

      <div className={cx(styles.edge, styles.edgeLeft)}>
        <ControlIndicator
          ref={echoRef}
          label="Echo"
          icon={<WaveformIcon />}
          status={gestureStatus}
          value={0.3}
          data-testid="studio-indicator-echo"
        />
      </div>
      <div className={cx(styles.edge, styles.edgeRight)}>
        <ControlIndicator
          ref={autotuneRef}
          label="Autotune"
          icon={<SparklesIcon />}
          status={gestureStatus}
          value={0.7}
          data-testid="studio-indicator-autotune"
        />
        <ControlIndicator
          label="Volume"
          icon={<VolumeIcon />}
          status="manual"
          value={VOCAL_VOLUME_UNITY}
          unityValue={VOCAL_VOLUME_UNITY}
          data-testid="studio-indicator-volume"
        />
      </div>

      <GlassPanel
        as="footer"
        radius="pill"
        padding="none"
        elevation="floating"
        className={styles.transport}
        data-testid="studio-transport"
      >
        <div className={styles.transportStart}>
          <span
            className={styles.clock}
            data-phase={recorder.phase}
            role="timer"
            aria-label="Recording time"
          >
            <i className={styles.clockDot} aria-hidden="true" />
            {formatClock(recorder.elapsedSec)}
          </span>
          <span className={styles.inputLevel}>
            <MicrophoneIcon size={14} />
            <LevelMeter ref={meterRef} label="Microphone level" size="sm" />
          </span>
        </div>
        <RecordButton
          state={recorder.phase}
          countdownValue={recorder.countdown}
          onClick={recorder.pressRecord}
          data-testid="studio-record-button"
        />
        <div className={styles.transportEnd}>
          <IconButton
            label={recorder.phase === 'paused' ? 'Resume' : 'Pause'}
            variant="ghost"
            size="lg"
            disabled={!isTakeActive}
            onClick={recorder.togglePause}
            data-testid="studio-pause-button"
          >
            {recorder.phase === 'paused' ? <PlayIcon /> : <PauseIcon />}
          </IconButton>
          <IconButton
            label="Start over"
            variant="ghost"
            size="lg"
            disabled={!isTakeActive}
            onClick={recorder.restart}
          >
            <RestartIcon />
          </IconButton>
        </div>
      </GlassPanel>

      <SettingsSheetMock open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
