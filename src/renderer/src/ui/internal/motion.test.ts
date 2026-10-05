import { describe, expect, it } from 'vitest';
import { parseCssTimeMs } from './motion';

describe('parseCssTimeMs', () => {
  it('reads milliseconds and seconds', () => {
    expect(parseCssTimeMs('200ms')).toBe(200);
    expect(parseCssTimeMs('0.2s')).toBe(200);
    expect(parseCssTimeMs('1.5s')).toBe(1500);
    expect(parseCssTimeMs('.3s')).toBe(300);
  });

  it('reads the near-zero duration used for reduced motion', () => {
    expect(parseCssTimeMs('0.01ms')).toBe(0.01);
    expect(parseCssTimeMs('1e-2ms')).toBe(0.01);
  });

  it('ignores surrounding whitespace and letter case', () => {
    // Custom properties come back from getComputedStyle exactly as written.
    expect(parseCssTimeMs(' 320ms ')).toBe(320);
    expect(parseCssTimeMs('2S')).toBe(2000);
  });

  it('returns 0 for anything that is not a non-negative time', () => {
    expect(parseCssTimeMs('')).toBe(0);
    expect(parseCssTimeMs('200')).toBe(0);
    expect(parseCssTimeMs('fast')).toBe(0);
    expect(parseCssTimeMs('var(--duration-base)')).toBe(0);
    expect(parseCssTimeMs('-200ms')).toBe(0);
    expect(parseCssTimeMs('200ms 100ms')).toBe(0);
  });
});
