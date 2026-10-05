// Keyboard shortcuts of the studio screen as a pure mapping: a key press plus what the
// screen is doing right now gives at most one command. The DOM wiring lives in
// useStudioShortcuts.ts.
import type { ControlId } from '@shared/controls';
import type { RecordingStatus } from '@renderer/state/studioTypes';

/** How far one press of an arrow key (or = / -) moves a control. */
export const NUDGE_STEP = 0.05;

export type ShortcutCommand =
  | { type: 'start-recording' }
  | { type: 'stop-recording' }
  | { type: 'toggle-pause' }
  | { type: 'toggle-preview' }
  | { type: 'cancel-countdown' }
  | { type: 'cancel-discard-prompt' }
  | { type: 'close-controls' }
  | { type: 'nudge'; control: ControlId; delta: number }
  | { type: 'toggle-monitoring' }
  | { type: 'open-settings' };

/** The parts of a KeyboardEvent the mapping looks at. */
export interface ShortcutKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** True for the repeats a held key produces. */
  repeat: boolean;
}

/** What the element with keyboard focus does with keys itself. */
export interface ShortcutFocus {
  /** A text field or a menu has focus: every key except Escape belongs to it. */
  typing: boolean;
  /** The focused control moves with the arrow keys (slider, radio group). */
  ownsArrows: boolean;
  /** The focused control is pressed with Space (a button reached with the keyboard). */
  ownsSpace: boolean;
}

export interface ShortcutContext {
  recordingStatus: RecordingStatus;
  /** Whether a new take can start right now (audio running, no blocking problem). */
  canRecord: boolean;
  hasBackingTrack: boolean;
  /** A sheet or dialog is open: only Escape is handled. */
  dialogOpen: boolean;
  /** The "discard this take?" prompt of the record bar is showing. */
  discardPromptOpen: boolean;
  /** The controls panel is open and can be closed (it cannot in Audio Only). */
  controlsPanelOpen: boolean;
  focus: ShortcutFocus;
}

export const NO_FOCUS: ShortcutFocus = { typing: false, ownsArrows: false, ownsSpace: false };

const NUDGE_KEYS: Record<string, { control: ControlId; direction: 1 | -1 }> = {
  ArrowUp: { control: 'autotune', direction: 1 },
  ArrowDown: { control: 'autotune', direction: -1 },
  ArrowRight: { control: 'echo', direction: 1 },
  ArrowLeft: { control: 'echo', direction: -1 },
  '=': { control: 'volume', direction: 1 },
  // The same physical key with Shift held.
  '+': { control: 'volume', direction: 1 },
  '-': { control: 'volume', direction: -1 },
  _: { control: 'volume', direction: -1 },
};

function escapeCommand(context: ShortcutContext): ShortcutCommand | null {
  if (context.recordingStatus === 'countdown') return { type: 'cancel-countdown' };
  if (context.discardPromptOpen) return { type: 'cancel-discard-prompt' };
  if (context.controlsPanelOpen) return { type: 'close-controls' };
  return null;
}

function recordCommand(context: ShortcutContext): ShortcutCommand | null {
  switch (context.recordingStatus) {
    case 'idle':
      return context.canRecord ? { type: 'start-recording' } : null;
    case 'recording':
    case 'paused':
      return { type: 'stop-recording' };
    default:
      return null;
  }
}

function spaceCommand(context: ShortcutContext): ShortcutCommand | null {
  switch (context.recordingStatus) {
    case 'recording':
    case 'paused':
      return { type: 'toggle-pause' };
    case 'idle':
      return context.hasBackingTrack ? { type: 'toggle-preview' } : null;
    default:
      return null;
  }
}

/** The command a key press stands for right now, or null when it is not a shortcut. */
export function resolveShortcut(
  key: ShortcutKey,
  context: ShortcutContext,
): ShortcutCommand | null {
  if (key.key === 'Escape') return escapeCommand(context);
  if (context.dialogOpen || context.focus.typing || key.altKey) return null;

  if (key.metaKey || key.ctrlKey) {
    return key.key === ',' && !key.repeat ? { type: 'open-settings' } : null;
  }

  const nudge = NUDGE_KEYS[key.key];
  if (nudge) {
    const usesArrows = key.key.startsWith('Arrow');
    if (usesArrows && context.focus.ownsArrows) return null;
    return { type: 'nudge', control: nudge.control, delta: nudge.direction * NUDGE_STEP };
  }

  // One press, one action: a held key must not start and stop a take over and over.
  if (key.repeat) return null;

  switch (key.key.toLowerCase()) {
    case 'r':
      return recordCommand(context);
    case ' ':
      return context.focus.ownsSpace ? null : spaceCommand(context);
    case 'm':
      return { type: 'toggle-monitoring' };
    default:
      return null;
  }
}

/** The one DOM capability the focus check needs, so it can be tested without a DOM. */
export interface FocusTarget {
  matches(selector: string): boolean;
}

const TYPING_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const ARROW_SELECTOR = '[role="slider"], [role="radio"], [role="radiogroup"]';
const SPACE_SELECTOR = 'button, a[href], summary, [role="button"], [role="switch"]';

/**
 * Describes the focused element (document.activeElement, or null).
 *
 * A button only owns Space when it shows keyboard focus. After a mouse click focus stays on
 * the button that was clicked, and Space pressed then is meant as the shortcut: a singer who
 * clicks Record and later hits Space wants to pause, not to press Record again.
 */
export function describeFocus(target: FocusTarget | null): ShortcutFocus {
  if (!target) return NO_FOCUS;
  return {
    typing: target.matches(TYPING_SELECTOR),
    ownsArrows: target.matches(ARROW_SELECTOR),
    ownsSpace: target.matches(SPACE_SELECTOR) && target.matches(':focus-visible'),
  };
}
