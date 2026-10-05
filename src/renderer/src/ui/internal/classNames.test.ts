import { describe, expect, it } from 'vitest';
import { cx } from './classNames';

describe('cx', () => {
  it('joins class names in order', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c');
  });

  it('drops false, null, undefined and empty strings', () => {
    const isActive = false;
    expect(cx('base', isActive && 'active', null, undefined, '', 'end')).toBe('base end');
  });

  it('returns an empty string when nothing is truthy', () => {
    expect(cx(false, undefined)).toBe('');
  });
});
