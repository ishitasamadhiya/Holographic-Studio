import { describe, expect, it } from 'vitest';
import type { GestureFrame, HandState, HandStatus } from '@gestures/index';
import { areBothHandsLost, createHandsLostTimer, HANDS_HINT_DELAY_MS } from './handsLost';

function hand(side: 'left' | 'right', status: HandStatus): HandState {
  return { side, status, openness: 0, proximity: 0.5, scale: 0, confidence: 0, landmarks: null };
}

function frame(left: HandStatus, right: HandStatus): GestureFrame {
  return { timestampMs: 0, left: hand('left', left), right: hand('right', right) };
}

describe('areBothHandsLost', () => {
  it('is true only when neither hand is tracked or held', () => {
    expect(areBothHandsLost(frame('lost', 'lost'))).toBe(true);
    expect(areBothHandsLost(frame('tracking', 'lost'))).toBe(false);
    expect(areBothHandsLost(frame('lost', 'holding'))).toBe(false);
    expect(areBothHandsLost(frame('tracking', 'tracking'))).toBe(false);
  });

  it('treats a missing frame as lost', () => {
    expect(areBothHandsLost(null)).toBe(true);
  });
});

describe('createHandsLostTimer', () => {
  it('waits for the whole delay before reporting', () => {
    const timer = createHandsLostTimer();
    expect(timer.update(true, 1000)).toBe(false);
    expect(timer.update(true, 1000 + HANDS_HINT_DELAY_MS - 1)).toBe(false);
    expect(timer.update(true, 1000 + HANDS_HINT_DELAY_MS)).toBe(true);
    expect(timer.update(true, 9000)).toBe(true);
  });

  it('clears at once when a hand returns and starts over afterwards', () => {
    const timer = createHandsLostTimer(500);
    timer.update(true, 0);
    expect(timer.update(true, 600)).toBe(true);
    expect(timer.update(false, 700)).toBe(false);
    expect(timer.update(true, 800)).toBe(false);
    expect(timer.update(true, 1299)).toBe(false);
    expect(timer.update(true, 1300)).toBe(true);
  });

  it('starts over after a reset', () => {
    const timer = createHandsLostTimer(500);
    timer.update(true, 0);
    timer.reset();
    expect(timer.update(true, 600)).toBe(false);
    expect(timer.update(true, 1100)).toBe(true);
  });
});
