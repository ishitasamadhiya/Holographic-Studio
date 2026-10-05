import { describe, expect, it } from 'vitest';
import { edgeGainAt } from './backingPlayer';

describe('edgeGainAt', () => {
  it('is full level for a run that starts at the top of the track', () => {
    expect(edgeGainAt({ fadeInFromSec: null }, 0)).toBe(1);
    expect(edgeGainAt({ fadeInFromSec: null }, 12.3)).toBe(1);
  });

  it('follows the 5 ms fade-in of a mid-song start, then holds full level', () => {
    const voice = { fadeInFromSec: 10 };
    expect(edgeGainAt(voice, 9.99)).toBe(0);
    expect(edgeGainAt(voice, 10)).toBe(0);
    expect(edgeGainAt(voice, 10.0025)).toBeCloseTo(0.5, 9);
    expect(edgeGainAt(voice, 10.005)).toBe(1);
    expect(edgeGainAt(voice, 11)).toBe(1);
  });
});
