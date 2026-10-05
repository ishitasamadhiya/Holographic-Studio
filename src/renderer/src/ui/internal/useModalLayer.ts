import { type RefObject, useEffect, useRef } from 'react';
import { nextTabStop } from './focusTrap';
import { overlayStack } from './overlayStack';

export interface ModalLayerOptions {
  /** The dialog element. It must be focusable (tabIndex -1) to receive the initial focus. */
  containerRef: RefObject<HTMLElement | null>;
  active: boolean;
  /** Called when Escape is pressed while this is the top-most layer. Omit to ignore Escape. */
  onEscape?: () => void;
}

/**
 * Modal keyboard behaviour for a dialog-like layer: moves focus into it when it opens, keeps
 * Tab / Shift+Tab cycling inside it (plus any companion region, see focusTrap.ts), closes on
 * Escape, and puts focus back where it came from when it closes. With stacked layers only
 * the top-most one reacts.
 */
export function useModalLayer({ containerRef, active, onEscape }: ModalLayerOptions): void {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    const registration = overlayStack.register();
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // An element that asked for focus itself (autoFocus) keeps it.
    if (!container.contains(document.activeElement)) {
      const preferred = container.querySelector<HTMLElement>('[data-autofocus]');
      (preferred ?? container).focus({ preventScroll: true });
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!registration.isTopMost()) return;

      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      // Ctrl+Tab and friends belong to the system, not to focus navigation.
      if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;

      // Always handled here, never by the browser, so focus cannot slip out of the layer.
      event.preventDefault();
      (nextTabStop(container, event.shiftKey ? -1 : 1) ?? container).focus();
    };

    // Capture phase: runs before handlers inside the layer and before anything behind it.
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      registration.release();
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [active, containerRef]);
}
