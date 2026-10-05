// Where the backing track is, on the audio frame clock. Pure maths shared by the engine
// (UI thread) and the vocal-chain worklet (audio thread).

/** One run of backing playback: from `startFrame` it plays the track from `offsetSec`. */
export interface SongClockState {
  /** Frame at which the backing track starts sounding in the graph. */
  startFrame: number;
  /** First frame at which it is silent again: stopped, or played through to its end. */
  stopFrame: number;
  /** Track position at `startFrame`, in seconds. */
  offsetSec: number;
}

/**
 * Song position the singer was HEARING when they sang the block that is now arriving at the
 * vocal chain, or null when the backing track is not playing during that block.
 *
 * The block's first frame is being rendered at `blockFrame`. The voice in it left the
 * singer's mouth one input latency ago, and what they heard at that moment had been rendered
 * one output latency before that.
 */
export function sungSongPosition(
  clock: SongClockState,
  blockFrame: number,
  sampleRate: number,
  roundTripLatencySec: number,
): number | null {
  if (blockFrame < clock.startFrame || blockFrame >= clock.stopFrame) return null;
  return (blockFrame - clock.startFrame) / sampleRate + clock.offsetSec - roundTripLatencySec;
}

/**
 * Song position reaching the listener's ears at audio-clock time `currentTimeSec`, or null
 * when nothing of this run is audible: before it starts, or once its end has been heard.
 */
export function heardSongPosition(
  clock: SongClockState,
  currentTimeSec: number,
  sampleRate: number,
  outputLatencySec: number,
): number | null {
  const renderedFrame = currentTimeSec * sampleRate;
  if (renderedFrame < clock.startFrame) return null;
  const heardFrame = renderedFrame - outputLatencySec * sampleRate;
  if (heardFrame >= clock.stopFrame) return null;
  return clock.offsetSec + Math.max(0, heardFrame - clock.startFrame) / sampleRate;
}

/** Track position of the sample rendered at `frame`, clamped to the run. */
export function renderedSongPosition(
  clock: SongClockState,
  frame: number,
  sampleRate: number,
): number {
  const clamped = Math.min(Math.max(frame, clock.startFrame), clock.stopFrame);
  return clock.offsetSec + (clamped - clock.startFrame) / sampleRate;
}
