import type { ReactNode } from 'react';
import { VOCAL_VOLUME_UNITY, type ControlId } from '@shared/controls';
import { SparklesIcon, VolumeIcon, WaveformIcon } from '@renderer/ui';

export interface ControlCopy {
  id: ControlId;
  label: string;
  icon: ReactNode;
  /** Which hand movement drives the control in Gesture. */
  gestureHint: string;
  /** A notable value marked on the control's slider and indicator. */
  unityValue?: number;
}

export const CONTROL_COPY: Record<ControlId, ControlCopy> = {
  autotune: {
    id: 'autotune',
    label: 'Autotune',
    icon: <SparklesIcon />,
    gestureHint: 'Open your right hand',
  },
  echo: {
    id: 'echo',
    label: 'Echo',
    icon: <WaveformIcon />,
    gestureHint: 'Open your left hand',
  },
  volume: {
    id: 'volume',
    label: 'Volume',
    icon: <VolumeIcon />,
    gestureHint: 'Right hand distance',
    unityValue: VOCAL_VOLUME_UNITY,
  },
};

/** The order the controls are listed in panels. */
export const CONTROL_ORDER: readonly ControlId[] = ['autotune', 'echo', 'volume'];
