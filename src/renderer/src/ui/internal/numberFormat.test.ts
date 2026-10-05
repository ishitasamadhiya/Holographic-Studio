import { describe, expect, it } from 'vitest';
import { formatPercent, toUnitInterval } from './numberFormat';

describe('toUnitInterval', () => {
  it('passes values inside the range through', () => {
    expect(toUnitInterval(0.25)).toBe(0.25);
  });

  it('clamps values outside the range', () => {
    expect(toUnitInterval(-0.2)).toBe(0);
    expect(toUnitInterval(1.7)).toBe(1);
  });

  it('maps non-finite input to 0', () => {
    expect(toUnitInterval(Number.NaN)).toBe(0);
    expect(toUnitInterval(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('formatPercent', () => {
  it('rounds to a whole percentage', () => {
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.336)).toBe('34%');
  });

  it('clamps before formatting', () => {
    expect(formatPercent(3)).toBe('100%');
    expect(formatPercent(-1)).toBe('0%');
  });
});
