import { useRef } from 'react';
import { useLiveFrame } from '@renderer/state/studioContext';
import type { LiveReadouts } from '@renderer/state/studioTypes';
import {
  amplitudeToMeterLevel,
  cx,
  LevelMeter,
  type LevelMeterHandle,
  MicrophoneIcon,
} from '@renderer/ui';
import styles from './MicLevel.module.css';

export interface MicLevelProps {
  /** Called every animation frame with the live readouts, after the meter is updated. */
  onFrame?: (live: LiveReadouts) => void;
  /** Roomier, for the step that is all about the meter. */
  prominent?: boolean;
  'data-testid'?: string;
}

/** The live microphone level: the bar moves when the singer makes a sound. */
export function MicLevel({ onFrame, prominent = false, ...rest }: MicLevelProps) {
  const meter = useRef<LevelMeterHandle>(null);

  useLiveFrame((live) => {
    meter.current?.setLevel(amplitudeToMeterLevel(live.inputLevel));
    onFrame?.(live);
  });

  return (
    <div className={cx(styles.level, prominent && styles.prominent)}>
      <MicrophoneIcon className={styles.icon} />
      <LevelMeter ref={meter} label="Microphone level" {...rest} />
    </div>
  );
}
