import { describe, expect, it } from 'vitest';
import { frameToTime, resolveScheduleFrame, schedulingLeadSec, timeToFrame } from './timing';

const RATE = 48000;

describe('frame conversions', () => {
  it('round-trips whole frames exactly', () => {
    for (const frame of [0, 1, 127, 128, 48000, 123_456_789]) {
      expect(timeToFrame(frameToTime(frame, RATE), RATE)).toBe(frame);
    }
  });

  it('rounds a time to the nearest frame', () => {
    expect(timeToFrame(1.00001, RATE)).toBe(48000);
    expect(timeToFrame(1.000011, RATE)).toBe(48001);
  });
});

describe('schedulingLeadSec', () => {
  it('covers one device buffer plus two render blocks', () => {
    const deviceBufferSec = 512 / RATE;
    expect(schedulingLeadSec(deviceBufferSec, RATE)).toBeCloseTo((512 + 256) / RATE, 12);
  });

  it('never drops below a few milliseconds, even without a reported buffer size', () => {
    expect(schedulingLeadSec(0, RATE)).toBeCloseTo(256 / RATE, 12);
    expect(schedulingLeadSec(Number.NaN, RATE)).toBeGreaterThanOrEqual(0.005);
    expect(schedulingLeadSec(0, 192000)).toBe(0.005);
  });
});

describe('resolveScheduleFrame', () => {
  it('defaults to the first frame at least one lead ahead of now', () => {
    expect(resolveScheduleFrame(undefined, 2, 0.01, RATE)).toBe(96480);
    expect(resolveScheduleFrame(undefined, 2.00000001, 0.01, RATE)).toBe(96481);
  });

  it('uses a requested time as given, so equal times give equal frames', () => {
    expect(resolveScheduleFrame(3.5, 2, 0.01, RATE)).toBe(168000);
    expect(resolveScheduleFrame(2.001, 2, 0.01, RATE)).toBe(96048);
  });

  it('never schedules in the past', () => {
    expect(resolveScheduleFrame(1, 2, 0.01, RATE)).toBe(96000);
  });

  it('treats a non-finite request like no request', () => {
    expect(resolveScheduleFrame(Number.NaN, 2, 0.01, RATE)).toBe(96480);
  });
});
