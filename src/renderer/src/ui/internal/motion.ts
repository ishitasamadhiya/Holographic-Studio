// The motion tokens in tokens.css are the single source of truth for animation timing. Code
// that has to wait for a CSS exit animation reads the token instead of repeating its value,
// which also makes it follow the reduced-motion override automatically.

export type DurationToken = '--duration-fast' | '--duration-base' | '--duration-slow';

/** Parses a CSS time ("200ms", "0.2s") into milliseconds. Anything unreadable is 0. */
export function parseCssTimeMs(text: string): number {
  const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(ms|s)$/i.exec(text.trim());
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return match[2]?.toLowerCase() === 's' ? amount * 1000 : amount;
}

/** The current value of a duration token, in milliseconds. */
export function readDurationMs(token: DurationToken): number {
  return parseCssTimeMs(getComputedStyle(document.documentElement).getPropertyValue(token));
}
