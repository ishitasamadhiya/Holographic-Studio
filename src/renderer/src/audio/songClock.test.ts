import { describe, expect, it } from 'vitest';
import {
  heardSongPosition,
  renderedSongPosition,
  sungSongPosition,
  type SongClockState,
} from './songClock';

const RATE = 48000;
/** Starts at audio time 2 s from 10 s into the track and stops (or ends) at audio time 5 s. */
const clock: SongClockState = { startFrame: 2 * RATE, stopFrame: 5 * RATE, offsetSec: 10 };

describe('sungSongPosition', () => {
  it('is the block time since the start, plus the offset, minus the round-trip latency', () => {
    const roundTrip = 0.012 + 0.02;
    expect(sungSongPosition(clock, 3 * RATE, RATE, roundTrip)).toBeCloseTo(11 - roundTrip, 12);
    expect(sungSongPosition(clock, 2 * RATE, RATE, roundTrip)).toBeCloseTo(10 - roundTrip, 12);
  });

  it('advances by exactly one block from one block to the next', () => {
    const first = sungSongPosition(clock, 2 * RATE + 1280, RATE, 0.03)!;
    const second = sungSongPosition(clock, 2 * RATE + 1408, RATE, 0.03)!;
    expect(second - first).toBeCloseTo(128 / RATE, 12);
  });

  it('is null before the backing starts and from the frame it stops', () => {
    expect(sungSongPosition(clock, 2 * RATE - 1, RATE, 0.03)).toBeNull();
    expect(sungSongPosition(clock, 5 * RATE - 1, RATE, 0.03)).not.toBeNull();
    expect(sungSongPosition(clock, 5 * RATE, RATE, 0.03)).toBeNull();
  });
});

describe('heardSongPosition', () => {
  const outputLatency = 0.02;

  it('lags the rendered position by the output latency', () => {
    expect(heardSongPosition(clock, 3, RATE, outputLatency)).toBeCloseTo(11 - outputLatency, 12);
  });

  it('is null until playback starts, then holds the offset until the first sound arrives', () => {
    expect(heardSongPosition(clock, 1.999, RATE, outputLatency)).toBeNull();
    expect(heardSongPosition(clock, 2.005, RATE, outputLatency)).toBe(10);
    expect(heardSongPosition(clock, 2.02 + 0.001, RATE, outputLatency)).toBeCloseTo(10.001, 9);
  });

  it('keeps reporting until the end has been heard, then is null', () => {
    expect(heardSongPosition(clock, 5.01, RATE, outputLatency)).toBeCloseTo(12.99, 9);
    expect(heardSongPosition(clock, 5.021, RATE, outputLatency)).toBeNull();
    expect(heardSongPosition(clock, 9, RATE, outputLatency)).toBeNull();
  });
});

describe('renderedSongPosition', () => {
  it('is exact in whole frames inside the run', () => {
    expect(renderedSongPosition(clock, 2 * RATE + 4800, RATE)).toBeCloseTo(10.1, 12);
  });

  it('clamps to the run', () => {
    expect(renderedSongPosition(clock, 0, RATE)).toBe(10);
    expect(renderedSongPosition(clock, 9 * RATE, RATE)).toBe(13);
  });
});
