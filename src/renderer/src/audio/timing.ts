// Conversions between the audio clock (seconds) and its frame counter, and the rule for when
// a scheduled action can still be honoured exactly.
import { RENDER_QUANTUM_FRAMES } from './engineConstants';

const MIN_SCHEDULING_LEAD_SEC = 0.005;

export function timeToFrame(timeSec: number, sampleRate: number): number {
  return Math.round(timeSec * sampleRate);
}

export function frameToTime(frame: number, sampleRate: number): number {
  return frame / sampleRate;
}

/**
 * How far ahead of `AudioContext.currentTime` an action must be scheduled to land on its exact
 * frame. The audio thread renders one device buffer (`baseLatency`) at a time, so it can be
 * that far ahead of the time the UI thread sees; two more render blocks cover the hop of a
 * message to the audio thread.
 */
export function schedulingLeadSec(baseLatencySec: number, sampleRate: number): number {
  const base = Number.isFinite(baseLatencySec) && baseLatencySec > 0 ? baseLatencySec : 0;
  return Math.max(MIN_SCHEDULING_LEAD_SEC, base + (2 * RENDER_QUANTUM_FRAMES) / sampleRate);
}

/**
 * The frame an action takes effect on. Without a requested time it is the earliest frame
 * that is still guaranteed to be exact; a requested time is used as given (never earlier
 * than now), so two actions given the same time always land on the same frame.
 */
export function resolveScheduleFrame(
  requestedTimeSec: number | undefined,
  currentTimeSec: number,
  leadSec: number,
  sampleRate: number,
): number {
  if (requestedTimeSec === undefined || !Number.isFinite(requestedTimeSec)) {
    return Math.ceil((currentTimeSec + leadSec) * sampleRate);
  }
  return Math.max(
    timeToFrame(requestedTimeSec, sampleRate),
    Math.ceil(currentTimeSec * sampleRate),
  );
}
