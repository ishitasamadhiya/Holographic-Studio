import { describe, expect, it } from 'vitest';
import { runShortcut, type ScreenControls } from './runShortcut';
import type { ShortcutCommand } from './shortcuts';

function setup(monitoringEnabled = true) {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
      return Promise.resolve();
    };
  const actions = {
    startRecording: record('startRecording'),
    stopRecording: record('stopRecording'),
    togglePause: record('togglePause'),
    togglePreviewPlayback: record('togglePreviewPlayback'),
    discardTake: record('discardTake'),
    nudgeManualControl: record('nudgeManualControl'),
    updateSettings: record('updateSettings'),
  };
  const screen: ScreenControls = {
    monitoringEnabled,
    closeDiscardPrompt: record('screen.closeDiscardPrompt'),
    closeControls: record('screen.closeControls'),
    openSettings: record('screen.openSettings'),
  };
  const run = (command: ShortcutCommand) => runShortcut(command, actions, screen);
  return { calls, run };
}

describe('runShortcut', () => {
  it('maps transport commands to their actions', () => {
    const { calls, run } = setup();
    run({ type: 'start-recording' });
    run({ type: 'toggle-pause' });
    run({ type: 'stop-recording' });
    run({ type: 'toggle-preview' });
    run({ type: 'cancel-countdown' });
    expect(calls.map((call) => call.name)).toEqual([
      'startRecording',
      'togglePause',
      'stopRecording',
      'togglePreviewPlayback',
      'discardTake',
    ]);
  });

  it('nudges the named control by the given step', () => {
    const { calls, run } = setup();
    run({ type: 'nudge', control: 'echo', delta: -0.05 });
    expect(calls).toEqual([{ name: 'nudgeManualControl', args: ['echo', -0.05] }]);
  });

  it('flips monitoring from its current setting', () => {
    const on = setup(true);
    on.run({ type: 'toggle-monitoring' });
    expect(on.calls[0]?.args).toEqual([{ audio: { monitoringEnabled: false } }]);

    const off = setup(false);
    off.run({ type: 'toggle-monitoring' });
    expect(off.calls[0]?.args).toEqual([{ audio: { monitoringEnabled: true } }]);
  });

  it('leaves screen-only commands to the screen', () => {
    const { calls, run } = setup();
    run({ type: 'cancel-discard-prompt' });
    run({ type: 'close-controls' });
    run({ type: 'open-settings' });
    expect(calls.map((call) => call.name)).toEqual([
      'screen.closeDiscardPrompt',
      'screen.closeControls',
      'screen.openSettings',
    ]);
  });
});
