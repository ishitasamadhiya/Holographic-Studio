import { useEffect, useRef } from 'react';
import {
  describeFocus,
  resolveShortcut,
  type ShortcutCommand,
  type ShortcutContext,
} from './shortcuts';

export type ScreenShortcutContext = Omit<ShortcutContext, 'focus'>;

/**
 * Listens for the studio's keyboard shortcuts on the window.
 * @param getContext what the screen is doing at the moment of the key press
 * @param run carries out the command the key press stands for
 */
export function useStudioShortcuts(
  getContext: () => ScreenShortcutContext,
  run: (command: ShortcutCommand) => void,
): void {
  const latest = useRef({ getContext, run });
  useEffect(() => {
    latest.current = { getContext, run };
  });

  useEffect(() => {
    let swallowSpaceKeyUp = false;

    const handleKeyDown = (event: KeyboardEvent) => {
      // A control that used the key itself (a slider moved by an arrow key) has said so.
      if (event.defaultPrevented || event.isComposing) return;

      const active = document.activeElement;
      const focus = describeFocus(active && active !== document.body ? active : null);
      const command = resolveShortcut(event, { ...latest.current.getContext(), focus });
      if (!command) return;

      // Also keeps Space and the arrow keys from scrolling a panel.
      event.preventDefault();
      // Space pressed with a mouse-focused button underneath: the button would otherwise
      // be "clicked" when the key is released.
      if (event.key === ' ') swallowSpaceKeyUp = true;
      latest.current.run(command);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ' || !swallowSpaceKeyUp) return;
      swallowSpaceKeyUp = false;
      event.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
}
