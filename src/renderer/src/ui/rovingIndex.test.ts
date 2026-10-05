import { describe, expect, it } from 'vitest';
import { edgeEnabledIndex, nextEnabledIndex } from './rovingIndex';

describe('nextEnabledIndex', () => {
  const allEnabled = [false, false, false];

  it('steps forwards and backwards', () => {
    expect(nextEnabledIndex(0, 1, allEnabled)).toBe(1);
    expect(nextEnabledIndex(2, -1, allEnabled)).toBe(1);
  });

  it('wraps around both ends', () => {
    expect(nextEnabledIndex(2, 1, allEnabled)).toBe(0);
    expect(nextEnabledIndex(0, -1, allEnabled)).toBe(2);
  });

  it('skips disabled options', () => {
    expect(nextEnabledIndex(0, 1, [false, true, false])).toBe(2);
    expect(nextEnabledIndex(2, 1, [true, false, false])).toBe(1);
    expect(nextEnabledIndex(0, -1, [false, false, true])).toBe(1);
  });

  it('stays put when nothing else is enabled', () => {
    expect(nextEnabledIndex(1, 1, [true, false, true])).toBe(1);
    expect(nextEnabledIndex(0, 1, [false])).toBe(0);
  });
});

describe('edgeEnabledIndex', () => {
  it('finds the first and last enabled options', () => {
    expect(edgeEnabledIndex(1, [true, false, false, true])).toBe(1);
    expect(edgeEnabledIndex(-1, [true, false, false, true])).toBe(2);
  });

  it('returns -1 when every option is disabled', () => {
    expect(edgeEnabledIndex(1, [true, true])).toBe(-1);
    expect(edgeEnabledIndex(-1, [true, true])).toBe(-1);
  });
});
