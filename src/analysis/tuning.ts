// Estimates how far a song's tuning sits from A = 440 Hz.
//
// Deviations from the equal-tempered grid repeat every semitone, so they are averaged as
// angles on a circle (a pitch 49 cents sharp and one 49 cents flat are neighbours, not
// opposites).

/** Evidence with less agreement than this is treated as "no idea": the tuning stays at 0. */
const MIN_CONCENTRATION = 0.2;

/** Weighted circular statistics of pitch deviations from the nearest semitone. */
export class TuningEvidence {
  private sumCos = 0;
  private sumSin = 0;
  private totalWeight = 0;

  add(midi: number, weight: number): void {
    const angle = 2 * Math.PI * (midi - Math.round(midi));
    this.sumCos += weight * Math.cos(angle);
    this.sumSin += weight * Math.sin(angle);
    this.totalWeight += weight;
  }

  /** Mean deviation in cents, -50..50. */
  get cents(): number {
    return (Math.atan2(this.sumSin, this.sumCos) / (2 * Math.PI)) * 100;
  }

  /** 0..1: 1 when all pitches share one deviation, near 0 when they are spread evenly. */
  get concentration(): number {
    if (this.totalWeight <= 0) return 0;
    return Math.hypot(this.sumCos, this.sumSin) / this.totalWeight;
  }
}

/**
 * Combines independent estimates (the instruments' spectral peaks, the sung melody), each
 * counting in proportion to how sharply it agrees with itself. Instruments are usually the
 * steadier witness; a singer wanders. Returns cents in -50..50, or 0 without clear evidence.
 */
export function combineTuning(sources: readonly TuningEvidence[]): number {
  let sumCos = 0;
  let sumSin = 0;
  let strongest = 0;
  for (const source of sources) {
    const angle = (source.cents / 100) * 2 * Math.PI;
    sumCos += source.concentration * Math.cos(angle);
    sumSin += source.concentration * Math.sin(angle);
    strongest = Math.max(strongest, source.concentration);
  }
  if (strongest < MIN_CONCENTRATION) return 0;
  const cents = (Math.atan2(sumSin, sumCos) / (2 * Math.PI)) * 100;
  return Math.max(-50, Math.min(50, cents));
}
