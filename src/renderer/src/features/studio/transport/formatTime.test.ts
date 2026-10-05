import { describe, expect, it } from 'vitest';
import { describeDuration, formatClock } from './formatTime';

describe('formatClock', () => {
  it('pads minutes and seconds to two digits', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(9)).toBe('00:09');
    expect(formatClock(84)).toBe('01:24');
  });

  it('shows only completed seconds', () => {
    expect(formatClock(59.99)).toBe('00:59');
    expect(formatClock(60)).toBe('01:00');
  });

  it('keeps counting minutes past the hour', () => {
    expect(formatClock(3725)).toBe('62:05');
  });

  it('treats unusable readings as zero', () => {
    expect(formatClock(-3)).toBe('00:00');
    expect(formatClock(Number.NaN)).toBe('00:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('00:00');
  });
});

describe('describeDuration', () => {
  it('uses seconds alone under a minute', () => {
    expect(describeDuration(0.4)).toBe('0 seconds');
    expect(describeDuration(1.2)).toBe('1 second');
    expect(describeDuration(42)).toBe('42 seconds');
  });

  it('uses minutes and seconds from a minute on', () => {
    expect(describeDuration(84.6)).toBe('1 min 24 sec');
    expect(describeDuration(120)).toBe('2 min');
    expect(describeDuration(605)).toBe('10 min 5 sec');
  });

  it('treats unusable readings as zero', () => {
    expect(describeDuration(Number.NaN)).toBe('0 seconds');
    expect(describeDuration(-10)).toBe('0 seconds');
  });
});
