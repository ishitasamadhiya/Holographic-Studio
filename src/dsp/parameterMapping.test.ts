import { describe, expect, it } from 'vitest';
import {
  AUTOTUNE_MAX_CORRECTION_SEMITONES,
  AUTOTUNE_RETUNE_FAST_SEC,
  AUTOTUNE_RETUNE_SLOW_SEC,
  autotuneAmount,
  autotuneRetuneSeconds,
  ECHO_FEEDBACK_CAP,
  ECHO_MAX_FEEDBACK,
  ECHO_MAX_WET,
  ECHO_MIN_FEEDBACK,
  echoFeedback,
  echoWet,
  limitEchoFeedback,
} from './parameterMapping';

const GRID = Array.from({ length: 201 }, (_, step) => step / 200);

describe('autotune intensity mapping', () => {
  it('has exact endpoints: nothing at 0, everything at 1', () => {
    expect(autotuneAmount(0)).toBe(0);
    expect(autotuneAmount(1)).toBe(1);
    expect(autotuneRetuneSeconds(0)).toBe(AUTOTUNE_RETUNE_SLOW_SEC);
    expect(autotuneRetuneSeconds(1)).toBeCloseTo(AUTOTUNE_RETUNE_FAST_SEC, 12);
  });

  it('increases the amount and shortens the retune time monotonically', () => {
    for (let i = 1; i < GRID.length; i++) {
      expect(autotuneAmount(GRID[i]!)).toBeGreaterThan(autotuneAmount(GRID[i - 1]!));
      expect(autotuneRetuneSeconds(GRID[i]!)).toBeLessThan(autotuneRetuneSeconds(GRID[i - 1]!));
    }
  });

  it('is a gentle, vibrato-preserving pull in the middle', () => {
    const amount = autotuneAmount(0.5);
    expect(amount).toBeGreaterThan(0.5);
    expect(amount).toBeLessThan(0.9);
    // A 5–7 Hz vibrato cycle lasts 140–200 ms; a correction this slow cannot follow it.
    expect(autotuneRetuneSeconds(0.5)).toBeGreaterThan(0.05);
  });

  it('is a hard tune at the top: full correction within a few milliseconds', () => {
    expect(autotuneRetuneSeconds(1)).toBeLessThanOrEqual(0.005);
    expect(autotuneRetuneSeconds(0.9)).toBeLessThan(0.02);
    expect(autotuneAmount(0.9)).toBeGreaterThan(0.98);
  });

  it('clamps out-of-range intensities', () => {
    expect(autotuneAmount(-2)).toBe(0);
    expect(autotuneAmount(7)).toBe(1);
    expect(autotuneRetuneSeconds(-2)).toBe(autotuneRetuneSeconds(0));
    expect(autotuneRetuneSeconds(7)).toBe(autotuneRetuneSeconds(1));
  });

  it('limits corrections to a few semitones', () => {
    expect(AUTOTUNE_MAX_CORRECTION_SEMITONES).toBeGreaterThanOrEqual(2.5);
    expect(AUTOTUNE_MAX_CORRECTION_SEMITONES).toBeLessThanOrEqual(4);
  });
});

describe('echo intensity mapping', () => {
  it('has exact endpoints: completely dry at 0, about half wet at 1', () => {
    expect(echoWet(0)).toBe(0);
    expect(echoWet(1)).toBe(ECHO_MAX_WET);
    expect(ECHO_MAX_WET).toBeGreaterThanOrEqual(0.45);
    expect(ECHO_MAX_WET).toBeLessThanOrEqual(0.5);
    expect(echoFeedback(0)).toBe(ECHO_MIN_FEEDBACK);
    expect(echoFeedback(1)).toBeCloseTo(ECHO_MAX_FEEDBACK, 12);
  });

  it('raises wet level and feedback monotonically', () => {
    for (let i = 1; i < GRID.length; i++) {
      expect(echoWet(GRID[i]!)).toBeGreaterThan(echoWet(GRID[i - 1]!));
      expect(echoFeedback(GRID[i]!)).toBeGreaterThan(echoFeedback(GRID[i - 1]!));
    }
  });

  it('keeps the feedback moderate and below the cap for every intensity', () => {
    expect(ECHO_FEEDBACK_CAP).toBeLessThan(0.75);
    for (const intensity of [...GRID, -1, 2, 100]) {
      expect(echoFeedback(intensity)).toBeLessThanOrEqual(ECHO_MAX_FEEDBACK + 1e-12);
      expect(echoFeedback(intensity)).toBeLessThan(ECHO_FEEDBACK_CAP);
    }
  });

  it('hard-caps any feedback value, however it was produced', () => {
    expect(limitEchoFeedback(0.4)).toBe(0.4);
    expect(limitEchoFeedback(0.99)).toBe(ECHO_FEEDBACK_CAP);
    expect(limitEchoFeedback(50)).toBe(ECHO_FEEDBACK_CAP);
    expect(limitEchoFeedback(Infinity)).toBe(ECHO_FEEDBACK_CAP);
    expect(limitEchoFeedback(-0.5)).toBe(0);
    expect(limitEchoFeedback(Number.NaN)).toBe(0);
  });
});
