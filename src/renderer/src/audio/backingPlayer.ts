// Backing-track transport: one AudioBufferSourceNode per run, scheduled on exact frames.
import { renderedSongPosition, type SongClockState } from './songClock';
import { frameToTime, resolveScheduleFrame, schedulingLeadSec } from './timing';

/** Fade at a mid-song start and at every stop, so the transport never clicks. */
const EDGE_FADE_SEC = 0.005;

interface BackingVoice {
  source: AudioBufferSourceNode;
  /** Carries only the edge fades; the backing volume lives further down the graph. */
  edge: GainNode;
  /** Audio-clock time the fade-in starts, or null when the run starts at full level. */
  fadeInFromSec: number | null;
  clock: SongClockState;
  /** True once the run is cut short; it then never counts as having played to the end. */
  stopping: boolean;
}

/** Level of a run's edge gain at `timeSec`, before any fade-out. */
export function edgeGainAt(voice: { fadeInFromSec: number | null }, timeSec: number): number {
  if (voice.fadeInFromSec === null) return 1;
  return Math.min(1, Math.max(0, (timeSec - voice.fadeInFromSec) / EDGE_FADE_SEC));
}

export interface BackingPlayerEvents {
  /** The run that the vocal chain's song clock should follow has changed. */
  onClockChanged(clock: SongClockState | null): void;
  /** The track played through to its end. */
  onEnded(): void;
}

export class BackingPlayer {
  private buffer: AudioBuffer | null = null;
  private voice: BackingVoice | null = null;
  /** Where the track last stopped; returned by stop() while nothing is playing. */
  private restingPositionSec = 0;

  constructor(
    private readonly context: AudioContext,
    private readonly output: AudioNode,
    private readonly events: BackingPlayerEvents,
  ) {}

  get isPlaying(): boolean {
    return this.voice !== null && !this.voice.stopping;
  }

  /** The current run — still set while a scheduled stop is playing out — or null. */
  get clock(): SongClockState | null {
    return this.voice?.clock ?? null;
  }

  setBuffer(buffer: AudioBuffer | null): void {
    this.cut();
    this.buffer = buffer;
    this.restingPositionSec = 0;
  }

  /**
   * Starts playback on `startFrame` from `offsetSec` into the track. Anything still playing
   * is stopped on that same frame. Returns the audio-clock time of the frame.
   */
  start(startFrame: number, offsetSec: number): number {
    const { context, buffer } = this;
    const sampleRate = context.sampleRate;
    const startTime = frameToTime(startFrame, sampleRate);
    // The outgoing run keeps playing until the new one takes over, then releases itself.
    this.stop(startFrame);
    this.voice = null;
    if (buffer === null) return startTime;

    const durationFrames = Math.round(buffer.duration * sampleRate);
    const requestedFrames = Number.isFinite(offsetSec) ? Math.round(offsetSec * sampleRate) : 0;
    const offsetFrames = Math.min(Math.max(requestedFrames, 0), durationFrames);
    this.restingPositionSec = frameToTime(offsetFrames, sampleRate);
    if (offsetFrames >= durationFrames) {
      this.events.onClockChanged(null);
      return startTime;
    }

    const source = context.createBufferSource();
    const edge = context.createGain();
    source.buffer = buffer;
    if (offsetFrames > 0) {
      edge.gain.setValueAtTime(0, startTime);
      edge.gain.linearRampToValueAtTime(1, startTime + EDGE_FADE_SEC);
    }
    source.connect(edge).connect(this.output);

    const voice: BackingVoice = {
      source,
      edge,
      fadeInFromSec: offsetFrames > 0 ? startTime : null,
      stopping: false,
      clock: {
        startFrame,
        stopFrame: startFrame + durationFrames - offsetFrames,
        offsetSec: frameToTime(offsetFrames, sampleRate),
      },
    };
    source.onended = () => {
      this.release(voice);
    };
    // A whole number of frames on both clocks, so the buffer is never interpolated.
    source.start(startTime, voice.clock.offsetSec);
    this.voice = voice;
    this.events.onClockChanged(voice.clock);
    return startTime;
  }

  /**
   * Stops playback on `stopFrame` and returns the track position there. A run that reaches
   * the end of the track first is left to finish, so its end is still reported.
   */
  stop(stopFrame: number): number {
    const voice = this.voice;
    if (voice === null || voice.stopping) return this.restingPositionSec;
    const frame = Math.max(stopFrame, voice.clock.startFrame);
    if (frame >= voice.clock.stopFrame) {
      return renderedSongPosition(voice.clock, voice.clock.stopFrame, this.context.sampleRate);
    }
    this.fadeOut(voice, frame);
    this.events.onClockChanged(voice.clock);
    return this.restingPositionSec;
  }

  /** Silences everything within a few milliseconds and forgets the transport state. */
  dispose(): void {
    this.cut();
    this.buffer = null;
  }

  /** Cuts a run short on `frame`, which lies inside the run, with a fade so it never clicks. */
  private fadeOut(voice: BackingVoice, frame: number): void {
    const { context } = this;
    const sampleRate = context.sampleRate;
    this.restingPositionSec = renderedSongPosition(voice.clock, frame, sampleRate);
    voice.stopping = true;
    voice.clock.stopFrame = frame;

    const stopTime = frameToTime(frame, sampleRate);
    const fadeStart = Math.max(context.currentTime, stopTime - EDGE_FADE_SEC);
    if (fadeStart < stopTime) {
      // A ramp runs from the previous automation event, so the fade-out needs an anchor at
      // its own start; without one it would stretch back to the end of the fade-in.
      voice.edge.gain.cancelAndHoldAtTime(fadeStart);
      voice.edge.gain.setValueAtTime(edgeGainAt(voice, fadeStart), fadeStart);
      voice.edge.gain.linearRampToValueAtTime(0, stopTime);
    }
    voice.source.stop(stopTime);
  }

  /**
   * Ends the current run as soon as the audio thread can still fade it out (a stop already
   * scheduled stands), without reporting it as "played to the end". It releases itself once
   * it has gone quiet.
   */
  private cut(): void {
    const voice = this.voice;
    if (voice === null) return;
    this.voice = null;
    if (!voice.stopping) {
      const { context } = this;
      const frame = resolveScheduleFrame(
        undefined,
        context.currentTime,
        schedulingLeadSec(context.baseLatency, context.sampleRate) + EDGE_FADE_SEC,
        context.sampleRate,
      );
      const inside = Math.max(frame, voice.clock.startFrame);
      if (inside < voice.clock.stopFrame) this.fadeOut(voice, inside);
      voice.stopping = true;
    }
    this.events.onClockChanged(null);
  }

  private release(voice: BackingVoice): void {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.edge.disconnect();
    if (this.voice === voice) this.voice = null;
    // Cut short, or followed by a run that is playing now: the track has not ended.
    if (voice.stopping || this.voice !== null) return;
    this.restingPositionSec = this.buffer?.duration ?? 0;
    this.events.onEnded();
  }
}
