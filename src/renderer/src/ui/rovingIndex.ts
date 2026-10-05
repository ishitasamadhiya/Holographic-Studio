// Keyboard navigation over a row of options where some may be disabled (segmented control).

/**
 * The next enabled index in `direction`, wrapping around the ends.
 * Returns `current` when no other option is enabled.
 */
export function nextEnabledIndex(
  current: number,
  direction: 1 | -1,
  disabled: readonly boolean[],
): number {
  const count = disabled.length;
  for (let offset = 1; offset < count; offset += 1) {
    const candidate = (((current + direction * offset) % count) + count) % count;
    if (!disabled[candidate]) return candidate;
  }
  return current;
}

/** The first (direction 1) or last (direction -1) enabled index, or -1 when all are disabled. */
export function edgeEnabledIndex(direction: 1 | -1, disabled: readonly boolean[]): number {
  return direction === 1 ? disabled.indexOf(false) : disabled.lastIndexOf(false);
}

/**
 * The option that holds the group's single tab stop: the selected one, or the first enabled
 * one when nothing is selected or the selection is disabled (as a native radio group does).
 * -1 when every option is disabled.
 */
export function tabStopIndex(selectedIndex: number, disabled: readonly boolean[]): number {
  if (selectedIndex >= 0 && disabled[selectedIndex] === false) return selectedIndex;
  return edgeEnabledIndex(1, disabled);
}
