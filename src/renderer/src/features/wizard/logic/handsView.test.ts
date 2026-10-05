import { describe, expect, it } from 'vitest';
import type { GestureFrame, HandState, HandStatus } from '@gestures/index';
import { DEFAULT_GESTURE_BINDINGS, type HandSide } from '@shared/controls';
import { HAND_INSTRUCTIONS, handsAnnouncement, handsInView, indicatorStatus } from './handsView';

function hand(side: HandSide, status: HandStatus): HandState {
  return {
    side,
    status,
    openness: 0.5,
    proximity: 0.5,
    scale: 0.2,
    confidence: 0.9,
    landmarks: null,
  };
}

function frame(left: HandStatus, right: HandStatus): GestureFrame {
  return { timestampMs: 0, left: hand('left', left), right: hand('right', right) };
}

describe('indicatorStatus', () => {
  it('passes the live gesture states through', () => {
    expect(indicatorStatus('gesture', true)).toBe('gesture-live');
    expect(indicatorStatus('holding', true)).toBe('holding');
    expect(indicatorStatus('returning', true)).toBe('returning');
  });

  it('tells "no hand in view" apart from a control the singer set to manual', () => {
    expect(indicatorStatus('manual', true)).toBe('lost');
    expect(indicatorStatus('manual', false)).toBe('manual');
  });
});

describe('handsInView', () => {
  it('sees no hands while tracking is off', () => {
    expect(handsInView(null)).toEqual({ left: false, right: false });
  });

  it('reports each hand separately', () => {
    expect(handsInView(frame('tracking', 'lost'))).toEqual({ left: true, right: false });
    expect(handsInView(frame('lost', 'tracking'))).toEqual({ left: false, right: true });
    expect(handsInView(frame('tracking', 'tracking'))).toEqual({ left: true, right: true });
  });

  it('does not count a hand that just disappeared', () => {
    expect(handsInView(frame('holding', 'holding'))).toEqual({ left: false, right: false });
  });
});

describe('handsAnnouncement', () => {
  it('names the hands that are in view', () => {
    expect(handsAnnouncement({ left: true, right: true })).toBe('Both hands in view');
    expect(handsAnnouncement({ left: false, right: true })).toBe('Right hand in view');
    expect(handsAnnouncement({ left: true, right: false })).toBe('Left hand in view');
    expect(handsAnnouncement({ left: false, right: false })).toBe('No hands in view');
  });
});

describe('HAND_INSTRUCTIONS', () => {
  it('teaches exactly the gestures the app is bound to', () => {
    expect(HAND_INSTRUCTIONS).toHaveLength(DEFAULT_GESTURE_BINDINGS.length);
    for (const binding of DEFAULT_GESTURE_BINDINGS) {
      const taught = HAND_INSTRUCTIONS.find((entry) => entry.control === binding.control);
      expect(taught?.hand).toBe(binding.hand);
      expect(taught?.instruction).toContain(`${binding.hand} hand`);
      expect(taught?.instruction).toMatch(binding.feature === 'openness' ? /open/i : /closer/i);
    }
  });
});
