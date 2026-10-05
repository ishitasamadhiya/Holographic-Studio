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
