import { describe, expect, it } from 'vitest';
import type { RecordingStatus } from '@renderer/state/studioTypes';
import {
  describeFocus,
  NO_FOCUS,
  NUDGE_STEP,
  resolveShortcut,
  type FocusTarget,
  type ShortcutContext,
  type ShortcutKey,
} from './shortcuts';

function press(key: string, modifiers: Partial<ShortcutKey> = {}): ShortcutKey {
  return { key, metaKey: false, ctrlKey: false, altKey: false, repeat: false, ...modifiers };
}

function context(overrides: Partial<ShortcutContext> = {}): ShortcutContext {
  return {
    recordingStatus: 'idle',
    canRecord: true,
    hasBackingTrack: false,
    dialogOpen: false,
    discardPromptOpen: false,
    controlsPanelOpen: false,
    focus: NO_FOCUS,
    ...overrides,
  };
}

const ALL_STATUSES: RecordingStatus[] = [
  'idle',
  'countdown',
  'recording',
  'paused',
  'finishing',
  'review',
  'exporting',
  'saved',
];

describe('resolveShortcut', () => {
  it('R starts a take when idle and stops one in progress', () => {
    expect(resolveShortcut(press('r'), context())).toEqual({ type: 'start-recording' });
    expect(resolveShortcut(press('R'), context())).toEqual({ type: 'start-recording' });
    expect(resolveShortcut(press('r'), context({ recordingStatus: 'recording' }))).toEqual({
      type: 'stop-recording',
    });
    expect(resolveShortcut(press('r'), context({ recordingStatus: 'paused' }))).toEqual({
      type: 'stop-recording',
    });
  });

  it('R does nothing when recording cannot start or the take is past stopping', () => {
    expect(resolveShortcut(press('r'), context({ canRecord: false }))).toBeNull();
    for (const recordingStatus of ['countdown', 'finishing', 'review', 'exporting', 'saved']) {
      expect(
        resolveShortcut(
          press('r'),
          context({ recordingStatus: recordingStatus as RecordingStatus }),
        ),
      ).toBeNull();
    }
  });

  it('Space pauses and resumes during a take', () => {
    expect(resolveShortcut(press(' '), context({ recordingStatus: 'recording' }))).toEqual({
      type: 'toggle-pause',
    });
    expect(resolveShortcut(press(' '), context({ recordingStatus: 'paused' }))).toEqual({
      type: 'toggle-pause',
    });
  });

  it('Space previews the backing track outside a take, when there is one', () => {
    expect(resolveShortcut(press(' '), context({ hasBackingTrack: true }))).toEqual({
      type: 'toggle-preview',
    });
    expect(resolveShortcut(press(' '), context({ hasBackingTrack: false }))).toBeNull();
    expect(
      resolveShortcut(press(' '), context({ recordingStatus: 'countdown', hasBackingTrack: true })),
    ).toBeNull();
  });

  it('Space is left to a button that has keyboard focus', () => {
    const focus = { ...NO_FOCUS, ownsSpace: true };
    expect(
      resolveShortcut(press(' '), context({ recordingStatus: 'recording', focus })),
    ).toBeNull();
    // Other shortcuts still work from there.
    expect(resolveShortcut(press('r'), context({ recordingStatus: 'recording', focus }))).toEqual({
      type: 'stop-recording',
    });
  });

  it('arrow keys, = and - nudge the three controls by 5%', () => {
    const nudge = (key: string) => resolveShortcut(press(key), context());
    expect(nudge('ArrowUp')).toEqual({ type: 'nudge', control: 'autotune', delta: NUDGE_STEP });
    expect(nudge('ArrowDown')).toEqual({ type: 'nudge', control: 'autotune', delta: -NUDGE_STEP });
    expect(nudge('ArrowRight')).toEqual({ type: 'nudge', control: 'echo', delta: NUDGE_STEP });
    expect(nudge('ArrowLeft')).toEqual({ type: 'nudge', control: 'echo', delta: -NUDGE_STEP });
    expect(nudge('=')).toEqual({ type: 'nudge', control: 'volume', delta: NUDGE_STEP });
    expect(nudge('+')).toEqual({ type: 'nudge', control: 'volume', delta: NUDGE_STEP });
    expect(nudge('-')).toEqual({ type: 'nudge', control: 'volume', delta: -NUDGE_STEP });
    expect(NUDGE_STEP).toBe(0.05);
  });

  it('nudges work in every recording state and repeat while the key is held', () => {
    for (const recordingStatus of ['idle', 'countdown', 'recording', 'paused'] as const) {
      expect(
        resolveShortcut(press('ArrowUp', { repeat: true }), context({ recordingStatus })),
      ).toEqual({ type: 'nudge', control: 'autotune', delta: NUDGE_STEP });
    }
  });

  it('arrow keys are left to a focused slider or radio group; = and - are not', () => {
    const focus = { ...NO_FOCUS, ownsArrows: true };
    expect(resolveShortcut(press('ArrowUp'), context({ focus }))).toBeNull();
    expect(resolveShortcut(press('ArrowLeft'), context({ focus }))).toBeNull();
    expect(resolveShortcut(press('='), context({ focus }))).toEqual({
      type: 'nudge',
      control: 'volume',
      delta: NUDGE_STEP,
    });
  });

  it('M toggles monitoring and Cmd+, or Ctrl+, opens settings', () => {
    expect(resolveShortcut(press('m'), context())).toEqual({ type: 'toggle-monitoring' });
    expect(resolveShortcut(press('M'), context({ recordingStatus: 'recording' }))).toEqual({
      type: 'toggle-monitoring',
    });
    expect(resolveShortcut(press(',', { metaKey: true }), context())).toEqual({
      type: 'open-settings',
    });
    expect(resolveShortcut(press(',', { ctrlKey: true }), context())).toEqual({
      type: 'open-settings',
    });
    expect(resolveShortcut(press(','), context())).toBeNull();
  });

  it('held keys do not repeat one-shot commands', () => {
    const held = { repeat: true };
    expect(resolveShortcut(press('r', held), context())).toBeNull();
    expect(resolveShortcut(press(' ', held), context({ recordingStatus: 'recording' }))).toBeNull();
    expect(resolveShortcut(press('m', held), context())).toBeNull();
    expect(resolveShortcut(press(',', { metaKey: true, repeat: true }), context())).toBeNull();
  });

  it('system key combinations are never taken', () => {
    expect(resolveShortcut(press('r', { metaKey: true }), context())).toBeNull();
    expect(resolveShortcut(press('m', { ctrlKey: true }), context())).toBeNull();
    expect(resolveShortcut(press('ArrowLeft', { metaKey: true }), context())).toBeNull();
    expect(resolveShortcut(press('ArrowUp', { altKey: true }), context())).toBeNull();
    expect(resolveShortcut(press('-', { metaKey: true }), context())).toBeNull();
  });

  it('everything except Escape is ignored while typing in a field', () => {
    const focus = { ...NO_FOCUS, typing: true };
    for (const key of ['r', ' ', 'm', 'ArrowUp', 'ArrowLeft', '=', '-']) {
      expect(resolveShortcut(press(key), context({ focus, hasBackingTrack: true }))).toBeNull();
    }
    expect(resolveShortcut(press(',', { metaKey: true }), context({ focus }))).toBeNull();
    expect(
      resolveShortcut(press('Escape'), context({ focus, recordingStatus: 'countdown' })),
    ).toEqual({ type: 'cancel-countdown' });
  });

  it('everything except Escape is ignored while a dialog is open', () => {
    for (const recordingStatus of ALL_STATUSES) {
      const open = context({ dialogOpen: true, recordingStatus, hasBackingTrack: true });
      for (const key of ['r', ' ', 'm', 'ArrowUp', 'ArrowRight', '=', '-']) {
        expect(resolveShortcut(press(key), open)).toBeNull();
      }
      expect(resolveShortcut(press(',', { metaKey: true }), open)).toBeNull();
    }
    expect(
      resolveShortcut(press('Escape'), context({ dialogOpen: true, controlsPanelOpen: true })),
    ).toEqual({ type: 'close-controls' });
  });

  it('Escape cancels the countdown first, then the discard prompt, then closes the panel', () => {
    const everything = context({
      recordingStatus: 'countdown',
      discardPromptOpen: true,
      controlsPanelOpen: true,
    });
    expect(resolveShortcut(press('Escape'), everything)).toEqual({ type: 'cancel-countdown' });
    expect(
      resolveShortcut(press('Escape'), { ...everything, recordingStatus: 'recording' }),
    ).toEqual({ type: 'cancel-discard-prompt' });
    expect(
      resolveShortcut(press('Escape'), {
        ...everything,
        recordingStatus: 'recording',
        discardPromptOpen: false,
      }),
    ).toEqual({ type: 'close-controls' });
    expect(resolveShortcut(press('Escape'), context({ recordingStatus: 'recording' }))).toBeNull();
  });

  it('other keys are not shortcuts', () => {
    for (const key of ['a', 'Enter', 'Tab', '1', 'Shift', 'F5']) {
      expect(resolveShortcut(press(key), context({ hasBackingTrack: true }))).toBeNull();
    }
  });
});

describe('describeFocus', () => {
  /** A stand-in element that matches exactly the listed simple selectors. */
  function element(...traits: string[]): FocusTarget {
    return {
      matches: (selector) =>
        selector
          .split(',')
          .map((part) => part.trim())
          .some((part) => traits.includes(part)),
    };
  }

  it('reports nothing special when nothing has focus', () => {
    expect(describeFocus(null)).toEqual(NO_FOCUS);
    expect(describeFocus(element('div'))).toEqual(NO_FOCUS);
  });

  it('recognises fields and menus as typing', () => {
    expect(describeFocus(element('input')).typing).toBe(true);
    expect(describeFocus(element('textarea')).typing).toBe(true);
    expect(describeFocus(element('select')).typing).toBe(true);
    expect(describeFocus(element('[contenteditable="true"]')).typing).toBe(true);
    expect(describeFocus(element('button')).typing).toBe(false);
  });

  it('recognises sliders and radios as owning the arrow keys', () => {
    expect(describeFocus(element('[role="slider"]')).ownsArrows).toBe(true);
    expect(describeFocus(element('[role="radio"]', 'button')).ownsArrows).toBe(true);
    expect(describeFocus(element('button')).ownsArrows).toBe(false);
  });

  it('gives Space to a button only while it shows keyboard focus', () => {
    expect(describeFocus(element('button', ':focus-visible')).ownsSpace).toBe(true);
    expect(describeFocus(element('[role="switch"]', ':focus-visible')).ownsSpace).toBe(true);
    // Focus left behind by a mouse click.
    expect(describeFocus(element('button')).ownsSpace).toBe(false);
    // A slider is not pressed with Space.
    expect(describeFocus(element('[role="slider"]', ':focus-visible')).ownsSpace).toBe(false);
  });
});
