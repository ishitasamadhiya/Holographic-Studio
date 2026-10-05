import { describe, expect, it } from 'vitest';
import { computeMonitoringLatencySec, OutputClock } from '@renderer/recording/syncTimeline';
import { describeLatency, outputClockReading, outputLatencySec } from './latency';

describe('outputLatencySec', () => {
  it('adds the context buffer and the device latency', () => {
    expect(outputLatencySec(0.005, 0.012)).toBeCloseTo(0.017, 12);
  });

  it('treats missing, negative and non-finite readings as zero', () => {
    expect(outputLatencySec(undefined, undefined)).toBe(0);
    expect(outputLatencySec(0.005, Number.NaN)).toBe(0.005);
    expect(outputLatencySec(-1, 0.01)).toBe(0.01);
  });
});

describe('describeLatency', () => {
  it('reports input, output and processing latency in seconds', () => {
    const latency = describeLatency({
      microphoneLatencySec: 0.01,
      baseLatencySec: 256 / 48000,
      deviceOutputLatencySec: 0.008,
      processingLatencyFrames: 240,
      sampleRate: 48000,
    });
    expect(latency.inputSec).toBe(0.01);
    expect(latency.outputSec).toBeCloseTo(256 / 48000 + 0.008, 12);
    expect(latency.processingSec).toBe(0.005);
    expect(computeMonitoringLatencySec(latency)).toBeCloseTo(
      0.01 + 0.005 + 256 / 48000 + 0.008,
      12,
    );
  });

  it('never reports a negative part', () => {
    const latency = describeLatency({
      microphoneLatencySec: -0.01,
      baseLatencySec: undefined,
      deviceOutputLatencySec: undefined,
      processingLatencyFrames: 0,
      sampleRate: 48000,
    });
    expect(latency).toEqual({ inputSec: 0, outputSec: 0, processingSec: 0 });
  });
});

describe('outputClockReading', () => {
  it('uses the output timestamp when the platform reports one', () => {
    const reading = outputClockReading(
      { contextTime: 3.2, performanceTime: 9500 },
      3.25,
      9510,
      0.02,
    );
    expect(reading).toEqual({ contextTimeSec: 3.2, performanceTimeMs: 9500 });
  });

  it.each([
    [{ contextTime: 0, performanceTime: 0 }],
    [{ contextTime: 3.2, performanceTime: 0 }],
    [{}],
    [{ contextTime: Number.NaN, performanceTime: 9500 }],
  ])('falls back to the latency estimate for %j', (reported) => {
    const reading = outputClockReading(reported, 3.25, 9510, 0.02);
    expect(reading.contextTimeSec).toBe(3.25);
    expect(reading.performanceTimeMs).toBeCloseTo(9530, 9);
  });

  it('produces readings an OutputClock accepts and agrees with', () => {
    const clock = new OutputClock();
    expect(clock.addSample(outputClockReading({}, 2, 5000, 0.015))).toBe(true);
    // Audio rendered at 2 s is heard 15 ms after "now"; audio rendered at 3 s a second later.
    expect(clock.heardAtMs(2)).toBeCloseTo(5015, 9);
    expect(clock.heardAtMs(3)).toBeCloseTo(6015, 9);
  });
});
