// Tab order inside a modal layer (sheet, dialog). The layer moves focus itself on every Tab
// press instead of letting the browser do it and only catching the ends: the browser's own
// order would leave the layer whenever our idea of "the last tab stop" is slightly off.

/**
 * Put this attribute on a region that lives outside the modal layers but must stay usable
 * while one is open (the toast viewport). Its tab stops are appended to the layer's cycle.
 */
export const MODAL_COMPANION_ATTRIBUTE = 'data-modal-companion';

const CANDIDATE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/**
 * The elements inside `root` that a Tab press can land on, in document order. Being
 * focusable is not enough: the unselected options of a radio group are focusable buttons
 * with tabindex="-1", and counting one of those as a tab stop is what once let focus escape.
 */
export function tabbableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      element.closest('[inert]') === null &&
      // Rendered at all, and not merely hidden with `visibility`.
      element.checkVisibility({ visibilityProperty: true }),
  );
}

function follows(reference: Node, candidate: Node): boolean {
  return (reference.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function precedes(reference: Node, candidate: Node): boolean {
  return (reference.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
}

/**
 * Where Tab (`direction` 1) or Shift+Tab (-1) should move focus while `container` is the
 * top-most modal layer: through the layer's own tab stops, then the companion regions',
 * then round again. Undefined when there is nothing to focus.
 */
export function nextTabStop(container: HTMLElement, direction: 1 | -1): HTMLElement | undefined {
  const own = tabbableElements(container);
  const companions = Array.from(
    document.querySelectorAll<HTMLElement>(`[${MODAL_COMPANION_ATTRIBUTE}]`),
  ).flatMap(tabbableElements);
  const stops = [...own, ...companions];

  const current = document.activeElement;
  const index = current instanceof HTMLElement ? stops.indexOf(current) : -1;
  if (index >= 0) return stops[(index + direction + stops.length) % stops.length];

  // Focus rests on something inside the layer that is not a tab stop (the dialog element
  // right after opening, a clicked label): carry on from where it sits in the document.
  if (current && container.contains(current)) {
    const neighbour =
      direction === 1
        ? own.find((stop) => follows(current, stop))
        : own.findLast((stop) => precedes(current, stop));
    if (neighbour) return neighbour;
  }
  return direction === 1 ? stops[0] : stops[stops.length - 1];
}
