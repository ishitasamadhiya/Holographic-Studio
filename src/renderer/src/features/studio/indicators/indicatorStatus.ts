import type { ControlStatus } from '@gestures/index';
import type { ControlIndicatorStatus } from '@renderer/ui';

/**
 * How an edge indicator presents a control. The gesture layer reports 'manual' both for a
 * control set to Manual and for a gesture control whose hand is gone and that has settled on
 * its slider value; the indicator tells the two apart ("Manual" versus "No hand").
 */
export function toIndicatorStatus(
  status: ControlStatus,
  gestureControlled: boolean,
): ControlIndicatorStatus {
  if (!gestureControlled) return 'manual';
  switch (status) {
    case 'gesture':
      return 'gesture-live';
    case 'holding':
      return 'holding';
    case 'returning':
      return 'returning';
    case 'manual':
      return 'lost';
  }
}
