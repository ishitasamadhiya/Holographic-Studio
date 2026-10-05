import type { StudioActions } from '@renderer/state/studioTypes';
import { runAction } from '../runAction';
import type { ShortcutCommand } from './shortcuts';

/** What a shortcut can change on the screen itself, as opposed to in the app. */
export interface ScreenControls {
  monitoringEnabled: boolean;
  closeDiscardPrompt(): void;
  closeControls(): void;
  openSettings(): void;
}

type ShortcutActions = Pick<
  StudioActions,
  | 'startRecording'
  | 'stopRecording'
  | 'togglePause'
  | 'togglePreviewPlayback'
  | 'discardTake'
  | 'nudgeManualControl'
  | 'updateSettings'
>;

/** Carries out the command a key press stands for. */
export function runShortcut(
  command: ShortcutCommand,
  actions: ShortcutActions,
  screen: ScreenControls,
): void {
  switch (command.type) {
    case 'start-recording':
      runAction(actions.startRecording());
      break;
    case 'stop-recording':
      runAction(actions.stopRecording());
      break;
    case 'toggle-pause':
      actions.togglePause();
      break;
    case 'toggle-preview':
      actions.togglePreviewPlayback();
      break;
    case 'cancel-countdown':
      runAction(actions.discardTake());
      break;
    case 'cancel-discard-prompt':
      screen.closeDiscardPrompt();
      break;
    case 'close-controls':
      screen.closeControls();
      break;
    case 'nudge':
      actions.nudgeManualControl(command.control, command.delta);
      break;
    case 'toggle-monitoring':
      actions.updateSettings({ audio: { monitoringEnabled: !screen.monitoringEnabled } });
      break;
    case 'open-settings':
      screen.openSettings();
      break;
  }
}
