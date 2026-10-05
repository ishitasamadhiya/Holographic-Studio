// The engine's latency report and the readings that keep the output clock fresh. Pure.
import {
  outputTimestampFromLatency,
  type LatencyBreakdown,
  type OutputTimestampSample,
} from '@renderer/recording/syncTimeline';

function nonNegative(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Delay between the graph rendering a sample and the listener hearing it: the buffer the
 * context hands to the system (`baseLatency`) plus what the system and the device add
 * (`outputLatency`, which Chromium may report as 0 until audio has been flowing for a moment).
 */
export function outputLatencySec(
  baseLatencySec: number | undefined,
  deviceLatencySec: number | undefined,
): number {
  return nonNegative(baseLatencySec) + nonNegative(deviceLatencySec);
}

export function describeLatency(parts: {
  microphoneLatencySec: number;
  baseLatencySec: number | undefined;
  deviceOutputLatencySec: number | undefined;
  processingLatencyFrames: number;
  sampleRate: number;
}): LatencyBreakdown {
  return {
    // Nothing is buffered between the microphone node and the vocal chain, and the chain
    // processes each render block in place, so the capture delay is the whole input side.
    inputSec: nonNegative(parts.microphoneLatencySec),
    outputSec: outputLatencySec(parts.baseLatencySec, parts.deviceOutputLatencySec),
    processingSec: nonNegative(parts.processingLatencyFrames) / parts.sampleRate,
  };
}

/**
 * One reading for the OutputClock. AudioContext.getOutputTimestamp() is preferred; where it
 * only reports zeros (no audio has reached the device yet, or the platform never fills it
 * in) an equivalent reading is derived from the current time and the output latency.
 */
export function outputClockReading(
  reported: { contextTime?: number; performanceTime?: number },
  currentTimeSec: number,
  nowPerformanceMs: number,
  latencySec: number,
): OutputTimestampSample {
  const { contextTime, performanceTime } = reported;
  if (
    typeof contextTime === 'number' &&
    typeof performanceTime === 'number' &&
    Number.isFinite(contextTime) &&
    Number.isFinite(performanceTime) &&
    contextTime > 0 &&
    performanceTime > 0
  ) {
    return { contextTimeSec: contextTime, performanceTimeMs: performanceTime };
  }
  return outputTimestampFromLatency(currentTimeSec, nowPerformanceMs, latencySec);
}
