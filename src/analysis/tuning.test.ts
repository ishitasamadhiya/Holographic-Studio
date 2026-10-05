import { describe, expect, it } from 'vitest';
import { TuningEvidence, combineTuning } from './tuning';

function evidenceOf(pitches: readonly number[], weight = 1): TuningEvidence {
  const evidence = new TuningEvidence();
  for (const pitch of pitches) evidence.add(pitch, weight);
  return evidence;
}

describe('TuningEvidence', () => {
  it('measures a common deviation exactly, whatever the notes are', () => {
    const evidence = evidenceOf([60.25, 64.25, 67.25, 71.25, 48.25]);
    expect(evidence.cents).toBeCloseTo(25, 6);
    expect(evidence.concentration).toBeCloseTo(1, 6);
  });

  it('treats +48 and -48 cents as neighbours, not as cancelling out', () => {
    const evidence = evidenceOf([60.48, 62.48, 63.52, 65.52]);
    expect(Math.abs(evidence.cents)).toBeGreaterThan(49);
    expect(evidence.concentration).toBeGreaterThan(0.9);
  });

  it('reports no concentration for evenly spread deviations', () => {
    const spread = Array.from({ length: 100 }, (_, index) => 60 + index / 100);
    expect(evidenceOf(spread).concentration).toBeLessThan(1e-9);
    expect(new TuningEvidence().concentration).toBe(0);
  });

  it('weights its samples', () => {
    const evidence = new TuningEvidence();
    evidence.add(60.1, 9);
    evidence.add(60.3, 1);
    expect(evidence.cents).toBeGreaterThan(10);
    expect(evidence.cents).toBeLessThan(13);
  });
});

describe('combineTuning', () => {
  it('returns 0 when no source agrees with itself', () => {
    const spread = Array.from({ length: 50 }, (_, index) => 60 + index / 50);
    expect(combineTuning([evidenceOf(spread), new TuningEvidence()])).toBe(0);
    expect(combineTuning([])).toBe(0);
  });

  it('follows the single clear source', () => {
    const spread = Array.from({ length: 50 }, (_, index) => 60 + index / 50);
    expect(combineTuning([evidenceOf([60.2, 62.2, 64.2]), evidenceOf(spread)])).toBeCloseTo(20, 6);
  });

  it('lets the more self-consistent source dominate', () => {
    const steady = evidenceOf([60.2, 62.2, 64.2, 65.2]);
    const wandering = evidenceOf([60.3, 61.9, 64.05, 64.6, 67.15, 66.7]);
    const combined = combineTuning([steady, wandering]);
    expect(wandering.concentration).toBeLessThan(0.6);
    expect(combined).toBeGreaterThan(wandering.cents);
    expect(combined).toBeLessThan(20);
    expect(Math.abs(combined - 20)).toBeLessThan(Math.abs(combined - wandering.cents));
  });
});
