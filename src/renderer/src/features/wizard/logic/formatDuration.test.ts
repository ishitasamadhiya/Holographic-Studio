import { describe, expect, it } from 'vitest';
import { formatDuration } from './formatDuration';

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(243)).toBe('4:03');
    expect(formatDuration(59.4)).toBe('0:59');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('rounds to the nearest second without producing ":60"', () => {
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(119.5)).toBe('2:00');
  });

  it('adds hours for very long files', () => {
    expect(formatDuration(3765)).toBe('1:02:45');
  });

  it('gives nothing for an unknown length', () => {
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(-3)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('');
  });
});
