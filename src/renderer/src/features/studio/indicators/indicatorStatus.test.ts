import { describe, expect, it } from 'vitest';
import { toIndicatorStatus } from './indicatorStatus';

describe('toIndicatorStatus', () => {
  it('follows the hand through live, hold and return while gesture controlled', () => {
    expect(toIndicatorStatus('gesture', true)).toBe('gesture-live');
    expect(toIndicatorStatus('holding', true)).toBe('holding');
    expect(toIndicatorStatus('returning', true)).toBe('returning');
  });

  it('shows a gesture control resting on its slider as a lost hand', () => {
    expect(toIndicatorStatus('manual', true)).toBe('lost');
  });

  it('is manual whenever the control is not following a hand', () => {
    expect(toIndicatorStatus('manual', false)).toBe('manual');
    // A stale readout from before the switch to Manual must not show as live.
    expect(toIndicatorStatus('gesture', false)).toBe('manual');
    expect(toIndicatorStatus('holding', false)).toBe('manual');
  });
});
