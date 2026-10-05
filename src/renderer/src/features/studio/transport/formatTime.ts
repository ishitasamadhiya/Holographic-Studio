// Time formatting for the transport and the export dialogs.

function wholeSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

/** 84.6 → "01:24". Minutes keep counting past the hour (3725 → "62:05"). */
export function formatClock(seconds: number): string {
  const total = wholeSeconds(seconds);
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** A take's length in words: 9 → "9 seconds", 84.6 → "1 min 24 sec", 120 → "2 min". */
export function describeDuration(seconds: number): string {
  const total = wholeSeconds(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) return rest === 1 ? '1 second' : `${rest} seconds`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} sec`;
}
