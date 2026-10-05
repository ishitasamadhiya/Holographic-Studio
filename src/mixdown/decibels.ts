export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Returns -Infinity for a gain of zero. */
export function gainToDb(gain: number): number {
  return 20 * Math.log10(gain);
}
