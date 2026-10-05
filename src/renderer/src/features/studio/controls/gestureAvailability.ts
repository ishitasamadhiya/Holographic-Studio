import type { RecordingMode } from '@shared/settings';

export type GestureUnavailableReason = 'audio-only' | 'hand-control-off';

/** Why the Gesture option cannot be chosen right now, or null when it can. */
export function gestureUnavailableReason(
  mode: RecordingMode,
  handControlEnabled: boolean,
): GestureUnavailableReason | null {
  if (mode === 'audio') return 'audio-only';
  if (!handControlEnabled) return 'hand-control-off';
  return null;
}

const REASON_TEXT: Record<GestureUnavailableReason, string> = {
  'audio-only': 'Hand control needs the camera. In Audio Only, use the sliders or the keyboard.',
  'hand-control-off': 'Hand control is turned off in Settings, so the sliders are in charge.',
};

export function describeGestureUnavailable(reason: GestureUnavailableReason): string {
  return REASON_TEXT[reason];
}
