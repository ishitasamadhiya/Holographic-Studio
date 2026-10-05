// Translates the gesture layer's vocabulary into what the hand-control step shows.
import type { ControlStatus, GestureFrame } from '@gestures/index';
import type { ControlId, HandSide } from '@shared/controls';
import type { ControlIndicatorStatus } from '@renderer/ui';

/**
 * The indicator style for a control. The gesture layer reports 'manual' both when the
 * singer chose the slider and when a gesture control has fallen back to it because no hand
 * is in view; `followsHand` tells the two apart.
 */
export function indicatorStatus(
  status: ControlStatus,
  followsHand: boolean,
): ControlIndicatorStatus {
  switch (status) {
    case 'gesture':
      return 'gesture-live';
    case 'holding':
      return 'holding';
    case 'returning':
      return 'returning';
    case 'manual':
      return followsHand ? 'lost' : 'manual';
  }
}

/** Whether each of the singer's hands is being followed right now. */
export function handsInView(gesture: GestureFrame | null): Record<HandSide, boolean> {
  return {
    left: gesture?.left.status === 'tracking',
    right: gesture?.right.status === 'tracking',
  };
}

/** What a screen reader is told about the hands, as one sentence. */
export function handsAnnouncement(inView: Record<HandSide, boolean>): string {
  if (inView.left && inView.right) return 'Both hands in view';
  if (inView.right) return 'Right hand in view';
  if (inView.left) return 'Left hand in view';
  return 'No hands in view';
}

export interface HandInstruction {
  control: ControlId;
  /** Control name as shown on its indicator. */
  label: string;
  hand: HandSide;
  /** One line: what to do with which hand. */
  instruction: string;
}

/** The three hand controls, in the order they are taught. Mirrors DEFAULT_GESTURE_BINDINGS. */
export const HAND_INSTRUCTIONS: readonly HandInstruction[] = [
  {
    control: 'autotune',
    label: 'Autotune',
    hand: 'right',
    instruction: 'Open and close your right hand',
  },
  {
    control: 'volume',
    label: 'Volume',
    hand: 'right',
    instruction: 'Move your right hand closer or farther',
  },
  {
    control: 'echo',
    label: 'Echo',
    hand: 'left',
    instruction: 'Open and close your left hand',
  },
];
