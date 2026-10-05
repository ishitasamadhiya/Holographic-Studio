import { describe, expect, it } from 'vitest';
import { describeGestureUnavailable, gestureUnavailableReason } from './gestureAvailability';

describe('gestureUnavailableReason', () => {
  it('allows gestures in video mode with hand control on', () => {
    expect(gestureUnavailableReason('video', true)).toBeNull();
  });

  it('names Audio Only first, because it applies whatever the hand control switch says', () => {
    expect(gestureUnavailableReason('audio', true)).toBe('audio-only');
    expect(gestureUnavailableReason('audio', false)).toBe('audio-only');
  });

  it('names the hand control switch in video mode', () => {
    expect(gestureUnavailableReason('video', false)).toBe('hand-control-off');
  });

  it('has one plain sentence per reason', () => {
    expect(describeGestureUnavailable('audio-only')).toContain('Audio Only');
    expect(describeGestureUnavailable('hand-control-off')).toContain('Settings');
  });
});
