import { describe, expect, it } from 'vitest';
import { fakeAudioBuffer } from '@renderer/recording/testing/fakeEngine';
import { BackingPlayer, edgeGainAt } from './backingPlayer';
import type { SongClockState } from './songClock';
import { schedulingLeadSec } from './timing';

const SAMPLE_RATE = 48000;
/** Seconds; a whole number of frames, like the real clock. */
const NOW_SEC = 10;
const BASE_LATENCY_SEC = 0.01;

interface ParamEvent {
  type: 'set' | 'ramp' | 'hold';
  timeSec: number;
  value?: number;
}

class FakeParam {
  readonly events: ParamEvent[] = [];

  setValueAtTime(value: number, timeSec: number): void {
    this.events.push({ type: 'set', timeSec, value });
  }

  linearRampToValueAtTime(value: number, timeSec: number): void {
    this.events.push({ type: 'ramp', timeSec, value });
  }

  cancelAndHoldAtTime(timeSec: number): void {
    this.events.push({ type: 'hold', timeSec });
  }
}

class FakeNode {
  connected = true;

  connect<T>(node: T): T {
    return node;
  }

  disconnect(): void {
    this.connected = false;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  stopTimes: number[] = [];

  start(): void {
    // Only scheduled; the tests decide when the run ends.
  }

  stop(timeSec = 0): void {
    this.stopTimes.push(timeSec);
  }

  /** The audio thread reached the end of the run (scheduled stop or end of the buffer). */
  finish(): void {
    this.onended?.();
  }
}

class FakeContext {
  readonly sampleRate = SAMPLE_RATE;
  readonly baseLatency = BASE_LATENCY_SEC;
  currentTime = NOW_SEC;
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

function setup(trackSec = 2) {
  const context = new FakeContext();
  const clocks: Array<SongClockState | null> = [];
  let ended = 0;
  const player = new BackingPlayer(
    context as unknown as AudioContext,
    new FakeNode() as unknown as AudioNode,
    {
      onClockChanged: (clock) => clocks.push(clock === null ? null : { ...clock }),
      onEnded: () => {
        ended += 1;
      },
    },
  );
  player.setBuffer(fakeAudioBuffer(trackSec, SAMPLE_RATE));
  return {
    context,
    player,
    clocks,
    get ended() {
      return ended;
    },
  };
}

const frameAt = (timeSec: number): number => Math.round(timeSec * SAMPLE_RATE);

describe('edgeGainAt', () => {
  it('is full level for a run that starts at the top of the track', () => {
    expect(edgeGainAt({ fadeInFromSec: null }, 0)).toBe(1);
    expect(edgeGainAt({ fadeInFromSec: null }, 12.3)).toBe(1);
  });

  it('follows the 5 ms fade-in of a mid-song start, then holds full level', () => {
    const voice = { fadeInFromSec: 10 };
    expect(edgeGainAt(voice, 9.99)).toBe(0);
    expect(edgeGainAt(voice, 10)).toBe(0);
    expect(edgeGainAt(voice, 10.0025)).toBeCloseTo(0.5, 9);
    expect(edgeGainAt(voice, 10.005)).toBe(1);
    expect(edgeGainAt(voice, 11)).toBe(1);
  });
});

describe('BackingPlayer', () => {
  it('fades a stop in the middle of the track and does not report it as the end', () => {
    const h = setup();
    h.player.start(frameAt(NOW_SEC + 0.1), 0);
    const position = h.player.stop(frameAt(NOW_SEC + 1.1));
    expect(position).toBeCloseTo(1, 9);
    const [source] = h.context.sources;
    expect(source?.stopTimes).toHaveLength(1);
    const stopSec = source?.stopTimes[0] ?? 0;
    expect(stopSec).toBeCloseTo(NOW_SEC + 1.1, 9);
    expect(h.context.gains[0]?.gain.events.at(-1)).toEqual({
      type: 'ramp',
      timeSec: stopSec,
      value: 0,
    });
    expect(h.player.isPlaying).toBe(false);
    source?.finish();
    expect(h.ended).toBe(0);
    expect(source?.connected).toBe(false);
  });

  it('lets a run that reaches the end of the track first finish, so the end is reported', () => {
    const h = setup(2);
    h.player.start(frameAt(NOW_SEC), 0);
    // A pause scheduled just after the last sample: the track is over by then.
    expect(h.player.stop(frameAt(NOW_SEC + 2.03))).toBeCloseTo(2, 9);
    const [source] = h.context.sources;
    expect(source?.stopTimes).toEqual([]);
    expect(h.player.isPlaying).toBe(true);
    source?.finish();
    expect(h.ended).toBe(1);
    expect(h.player.isPlaying).toBe(false);
  });

  it('still reports the end when a resume from the end of the track came before it', () => {
    const h = setup(2);
    h.player.start(frameAt(NOW_SEC), 0);
    const position = h.player.stop(frameAt(NOW_SEC + 2));
    // Resumed before the audio thread's "ended" arrived: nothing is left to play.
    h.player.start(frameAt(NOW_SEC + 2.1), position);
    expect(h.context.sources).toHaveLength(1);
    expect(h.clocks.at(-1)).toBeNull();
    h.context.sources[0]?.finish();
    expect(h.ended).toBe(1);
  });

  it('does not report the end of an earlier run while a newer one is playing', () => {
    const h = setup(2);
    h.player.start(frameAt(NOW_SEC), 0);
    h.player.start(frameAt(NOW_SEC + 2.5), 0);
    h.context.sources[0]?.finish();
    expect(h.ended).toBe(0);
    expect(h.player.isPlaying).toBe(true);
  });

  it('leaves a fade-out already under way alone when the track is replaced', () => {
    const h = setup();
    h.player.start(frameAt(NOW_SEC), 0);
    h.player.stop(frameAt(NOW_SEC + 0.5));
    const [source] = h.context.sources;
    const gainEvents = h.context.gains[0]?.gain.events.length;

    h.player.setBuffer(null);
    expect(source?.connected).toBe(true);
    expect(source?.stopTimes).toHaveLength(1);
    expect(h.context.gains[0]?.gain.events).toHaveLength(gainEvents ?? -1);
    expect(h.clocks.at(-1)).toBeNull();

    source?.finish();
    expect(source?.connected).toBe(false);
    expect(h.ended).toBe(0);
  });

  it('fades the music out instead of cutting it when the track is cleared while playing', () => {
    const h = setup();
    h.player.start(frameAt(NOW_SEC - 1), 0);
    h.player.setBuffer(null);

    const [source] = h.context.sources;
    const gain = h.context.gains[0]?.gain;
    expect(source?.connected).toBe(true);
    expect(h.player.isPlaying).toBe(false);
    expect(h.clocks.at(-1)).toBeNull();
    // The whole fade lies beyond what the audio thread may already have rendered.
    const earliestSec = NOW_SEC + schedulingLeadSec(BASE_LATENCY_SEC, SAMPLE_RATE);
    const stopSec = source?.stopTimes[0] ?? 0;
    expect(source?.stopTimes).toHaveLength(1);
    expect(gain?.events[0]).toEqual({ type: 'hold', timeSec: stopSec - 0.005 });
    expect(stopSec - 0.005).toBeGreaterThanOrEqual(earliestSec - 1e-9);
    expect(stopSec - earliestSec).toBeLessThan(0.006);
    expect(gain?.events.at(-1)).toEqual({ type: 'ramp', timeSec: stopSec, value: 0 });

    source?.finish();
    expect(source?.connected).toBe(false);
    expect(h.ended).toBe(0);
  });
});
