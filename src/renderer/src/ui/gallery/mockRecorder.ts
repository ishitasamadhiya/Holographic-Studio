import { useEffect, useReducer } from 'react';
import type { RecordButtonState } from '../RecordButton';

export interface MockRecorder {
  phase: RecordButtonState;
  /** Seconds left while counting down. */
  countdown: number;
  elapsedSec: number;
}

type MockRecorderAction = { type: 'press-record' | 'toggle-pause' | 'restart' | 'tick' };

const COUNTDOWN_SEC = 3;

function reduce(state: MockRecorder, action: MockRecorderAction): MockRecorder {
  switch (action.type) {
    case 'press-record':
      return state.phase === 'idle'
        ? { phase: 'countdown', countdown: COUNTDOWN_SEC, elapsedSec: 0 }
        : { phase: 'idle', countdown: COUNTDOWN_SEC, elapsedSec: 0 };
    case 'toggle-pause':
      if (state.phase === 'recording') return { ...state, phase: 'paused' };
      if (state.phase === 'paused') return { ...state, phase: 'recording' };
      return state;
    case 'restart':
      return { phase: 'countdown', countdown: COUNTDOWN_SEC, elapsedSec: 0 };
    case 'tick':
      if (state.phase === 'recording') return { ...state, elapsedSec: state.elapsedSec + 1 };
      if (state.phase !== 'countdown') return state;
      return state.countdown > 1
        ? { ...state, countdown: state.countdown - 1 }
        : { ...state, phase: 'recording' };
  }
}

/** A pretend recording session so the studio mock's transport behaves like the real thing. */
export function useMockRecorder(initial: MockRecorder) {
  const [state, dispatch] = useReducer(reduce, initial);
  const isRunning = state.phase === 'countdown' || state.phase === 'recording';

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  return {
    ...state,
    pressRecord: () => dispatch({ type: 'press-record' }),
    togglePause: () => dispatch({ type: 'toggle-pause' }),
    restart: () => dispatch({ type: 'restart' }),
  };
}

/** 84 → "01:24". */
export function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
