import { type RefObject, useEffect, useRef } from 'react';
import { CONTROL_IDS, type ControlId } from '@shared/controls';
import { useLiveFrame, useStudioActions, useStudioState } from '@renderer/state/studioContext';
import type { RecordingStatus } from '@renderer/state/studioTypes';
import {
  Button,
  formatPercent,
  IconButton,
  PauseIcon,
  PlayIcon,
  RecordButton,
  type RecordButtonState,
  Spinner,
  TrashIcon,
} from '@renderer/ui';
import { CONTROL_COPY, CONTROL_ORDER } from '../controls/controlCopy';
import { runAction } from '../runAction';
import { formatClock } from './formatTime';
import styles from './RecordBar.module.css';

/** The discard prompt steps aside by itself if it is not answered. */
const DISCARD_PROMPT_TIMEOUT_MS = 6000;

export interface RecordBarProps {
  /** Whether a new take can start (live audio is running, nothing is blocking). */
  canRecord: boolean;
  discardPromptOpen: boolean;
  onDiscardPromptChange: (open: boolean) => void;
}

/**
 * During the count-in the button is the way to call it off, so it shows the stop square
 * (the big number in the middle of the screen does the counting).
 */
function buttonState(status: RecordingStatus): RecordButtonState {
  switch (status) {
    case 'countdown':
    case 'recording':
      return 'recording';
    case 'paused':
      return 'paused';
    default:
      return 'idle';
  }
}

function setText(element: HTMLElement | null, text: string): void {
  if (element && element.textContent !== text) element.textContent = text;
}

/**
 * The transport at the bottom of the screen. Idle, it is just the record button; from the
 * countdown until the take is stopped it grows into a capsule with the time, the take's
 * status and the few things one can do mid-take.
 */
export function RecordBar({ canRecord, discardPromptOpen, onDiscardPromptChange }: RecordBarProps) {
  const status = useStudioState((state) => state.recording.status);
  const actions = useStudioActions();

  const isTake = status === 'recording' || status === 'paused';
  const isExpanded = isTake || status === 'countdown' || status === 'finishing';
  const promptVisible = discardPromptOpen && isTake;

  const timerRef = useRef<HTMLSpanElement>(null);
  const readoutRefs: Record<ControlId, RefObject<HTMLSpanElement | null>> = {
    autotune: useRef<HTMLSpanElement>(null),
    echo: useRef<HTMLSpanElement>(null),
    volume: useRef<HTMLSpanElement>(null),
  };
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const discardButtonRef = useRef<HTMLButtonElement>(null);

  // The time and the three readouts change many times a second; they are written straight
  // to the DOM instead of going through React.
  useLiveFrame((live) => {
    setText(timerRef.current, formatClock(live.recordingElapsedSec));
    for (const id of CONTROL_IDS) {
      setText(readoutRefs[id].current, formatPercent(live.controls[id]));
    }
  });

  useEffect(() => {
    if (!discardPromptOpen) return;
    if (!isTake) {
      onDiscardPromptChange(false);
      return;
    }
    const timer = window.setTimeout(() => onDiscardPromptChange(false), DISCARD_PROMPT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [discardPromptOpen, isTake, onDiscardPromptChange]);

  // Keyboard focus follows the prompt: onto the safe answer when it opens, and back to the
  // discard button when it closes while focus would otherwise be left on nothing.
  const wasPromptVisible = useRef(false);
  useEffect(() => {
    if (promptVisible) {
      keepButtonRef.current?.focus({ preventScroll: true });
    } else if (wasPromptVisible.current && document.activeElement === document.body) {
      discardButtonRef.current?.focus({ preventScroll: true });
    }
    wasPromptVisible.current = promptVisible;
  }, [promptVisible]);

  const handleRecordPress = () => {
    if (status === 'idle') runAction(actions.startRecording());
    else if (status === 'countdown') runAction(actions.discardTake());
    else if (isTake) runAction(actions.stopRecording());
  };

  const confirmDiscard = () => {
    onDiscardPromptChange(false);
    runAction(actions.discardTake());
  };

  return (
    <div
      className={styles.bar}
      data-testid="record-bar"
      data-status={status}
      data-expanded={isExpanded || undefined}
    >
      <div className={styles.start}>
        {isTake && (
          <div className={styles.take} data-testid="take-status">
            <div className={styles.clock}>
              <i className={styles.dot} aria-hidden="true" />
              <span
                ref={timerRef}
                className={styles.time}
                role="timer"
                aria-label="Recording time"
                data-testid="record-timer"
              />
              <span className={styles.statusLabel} data-testid="record-status-label">
                {status === 'paused' ? 'Paused' : 'Recording'}
              </span>
            </div>
            <dl className={styles.readouts} data-testid="record-readouts">
              {CONTROL_ORDER.map((id) => (
                <div key={id} className={styles.readout}>
                  <dt>{CONTROL_COPY[id].label}</dt>
                  <dd ref={readoutRefs[id]} data-testid={`record-readout-${id}`} />
                </div>
              ))}
            </dl>
          </div>
        )}
        {status === 'countdown' && <span className={styles.message}>Get ready…</span>}
        {status === 'finishing' && (
          <span className={styles.message} data-testid="record-finishing">
            <Spinner size="sm" label={null} />
            Finishing your take…
          </span>
        )}
      </div>

      <RecordButton
        state={buttonState(status)}
        aria-label={status === 'countdown' ? 'Cancel countdown' : undefined}
        disabled={status === 'idle' ? !canRecord : !(isTake || status === 'countdown')}
        onClick={handleRecordPress}
        data-testid="record-button"
      />

      <div className={styles.end}>
        {status === 'countdown' && (
          <Button
            variant="ghost"
            onClick={() => runAction(actions.discardTake())}
            data-testid="countdown-cancel"
          >
            Cancel
          </Button>
        )}
        {isTake && !promptVisible && (
          <>
            <IconButton
              label={status === 'paused' ? 'Resume recording' : 'Pause recording'}
              variant="ghost"
              size="lg"
              onClick={() => actions.togglePause()}
              data-testid="pause-button"
            >
              {status === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </IconButton>
            <IconButton
              ref={discardButtonRef}
              label="Discard this take"
              variant="ghost"
              size="lg"
              onClick={() => onDiscardPromptChange(true)}
              data-testid="discard-button"
            >
              <TrashIcon />
            </IconButton>
          </>
        )}
        {promptVisible && (
          <div
            className={styles.prompt}
            role="group"
            aria-label="Discard this take?"
            data-testid="discard-prompt"
          >
            <Button
              ref={keepButtonRef}
              size="sm"
              variant="ghost"
              onClick={() => onDiscardPromptChange(false)}
              data-testid="discard-keep"
            >
              Keep
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={confirmDiscard}
              data-testid="discard-confirm"
            >
              Discard take
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
