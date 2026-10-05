/** Clamps to 0..1 and treats NaN / ±Infinity as 0 so a bad reading can never break a meter. */
export function toUnitInterval(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 0.5 → "50%". The input is clamped to 0..1. */
export function formatPercent(fraction: number): string {
  return `${Math.round(toUnitInterval(fraction) * 100)}%`;
}
