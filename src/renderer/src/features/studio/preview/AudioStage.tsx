import { useRef } from 'react';
import { clamp01 } from '@shared/controls';
import { useLiveFrame } from '@renderer/state/studioContext';
import { MicrophoneIcon } from '@renderer/ui';
import styles from './AudioStage.module.css';

/** Per-frame easing toward the voice level: quick to rise, slow to fall, like breathing. */
const RISE = 0.22;
const FALL = 0.05;

/**
 * What Audio Only shows instead of the camera: a dark stage with one soft glow that swells
 * a little with the singer's voice. Deliberately nothing else moves.
 */
export function AudioStage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const level = useRef(0);

  useLiveFrame((live) => {
    const target = clamp01(live.outputLevel);
    level.current += (target - level.current) * (target > level.current ? RISE : FALL);
    stageRef.current?.style.setProperty('--voice-level', level.current.toFixed(3));
  });

  return (
    <div ref={stageRef} className={styles.stage} data-testid="audio-stage">
      <div className={styles.orb}>
        <div className={styles.glow} aria-hidden="true" />
        <div className={styles.ring} aria-hidden="true" />
        <MicrophoneIcon size={28} className={styles.icon} />
      </div>
      <p className={styles.caption}>
        <strong>Audio Only</strong>
        <span>Your voice and the backing track, without the camera.</span>
      </p>
    </div>
  );
}
