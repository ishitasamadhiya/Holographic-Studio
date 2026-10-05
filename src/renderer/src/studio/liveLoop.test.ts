import { describe, expect, it } from 'vitest';
import { FakeClock } from '@renderer/recording/testing/fakeClock';
import { FakeEngine } from '@renderer/recording/testing/fakeEngine';
import { createInitialLiveReadouts, createInitialStudioState } from '@renderer/state/staticStudio';
import { FRAME_WATCHDOG_MS, LiveLoop } from './liveLoop';

function setup() {
  const clock = new FakeClock();
  const engine = new FakeEngine(clock);
  engine.running = true;
  const state = createInitialStudioState();
  state.settings.controls.autotune = { source: 'manual', manual: 0.8 };
  const live = createInitialLiveReadouts();
  const latencies: number[] = [];
  const loop = new LiveLoop({
    clock,
    live,
    getState: () => state,
    getEngine: () => engine,
    getGesture: () => null,
    getRecordingElapsedSec: (nowMs) => nowMs / 1000,
    onMonitoringLatency: (latencyMs) => latencies.push(latencyMs),
  });
  return { clock, engine, live, loop, latencies };
}

describe('the live loop', () => {
  it('keeps updating on a timer when animation frames stop (hidden or covered window)', async () => {
    const h = setup();
    h.loop.start();
    await h.clock.advance(FRAME_WATCHDOG_MS * 5 + 1);
    expect(h.engine.controls?.autotune).toBe(0.8);
    expect(h.live.recordingElapsedSec).toBeCloseTo(h.clock.nowMs() / 1000, 1);
    h.loop.stop();
    expect(h.clock.pendingTimerCount).toBe(0);
    expect(h.clock.pendingFrameCount).toBe(0);
  });

  it('reports the monitoring latency about once a second', async () => {
    const h = setup();
    h.loop.start();
    for (let frame = 0; frame < 61; frame++) await h.clock.runFrame(1000 / 60);
    expect(h.latencies).toHaveLength(2);
    expect(h.latencies[0]).toBeCloseTo(35, 9);
    h.loop.stop();
  });

  it('zeroes the meters and leaves the engine alone while it is stopped', async () => {
    const h = setup();
    h.engine.running = false;
    h.live.inputLevel = 0.7;
    h.loop.tick();
    expect(h.live.inputLevel).toBe(0);
    expect(h.live.songPositionSec).toBeNull();
    expect(h.engine.controls).toBeNull();
    expect(h.live.controls.autotune).toBe(0.8);
  });

  it('survives a failing frame', async () => {
    const h = setup();
    h.engine.readMeters = () => {
      throw new Error('worklet gone');
    };
    h.loop.start();
    await h.clock.runFrame(16);
    await h.clock.runFrame(16);
    expect(h.loop.isRunning).toBe(true);
    h.loop.stop();
  });
});
