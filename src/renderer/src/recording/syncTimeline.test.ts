import { describe, expect, it } from 'vitest';
import {
  CameraLatencyEstimator,
  computeMonitoringLatencySec,
  computeVideoStartOffsetSec,
  computeVocalLatencySec,
  DEFAULT_CAMERA_LATENCY_MS,
  ElapsedTimer,
  estimateFirstFrameCaptureMs,
  OutputClock,
  outputTimestampFromLatency,
} from './syncTimeline';

describe('OutputClock', () => {
  it('maps audio time to the moment it is heard and back', () => {
    const clock = new OutputClock();
    // Audio rendered at 2.000 s is heard at performance time 5030 ms.
    clock.addSample({ contextTimeSec: 2, performanceTimeMs: 5030 });
    expect(clock.heardAtMs(2)).toBeCloseTo(5030, 6);
    expect(clock.heardAtMs(2.5)).toBeCloseTo(5530, 6);
    expect(clock.contextTimeHeardAt(5530)).toBeCloseTo(2.5, 9);
  });

  it('ignores jittery outliers by using the median reading', () => {
    const clock = new OutputClock();
    const trueOffsetMs = 1234;
    const jitter = [0, 1, -1, 2, -2, 0.5, -0.5, 40, -35, 0];
    jitter.forEach((error, index) => {
      const contextTimeSec = 1 + index * 0.1;
      clock.addSample({
        contextTimeSec,
        performanceTimeMs: contextTimeSec * 1000 + trueOffsetMs + error,
      });
    });
    expect(Math.abs(clock.heardAtMs(10) - (10_000 + trueOffsetMs))).toBeLessThan(1);
  });

  it('rejects the zero readings Chromium returns before audio is flowing', () => {
    const clock = new OutputClock();
    expect(clock.addSample({ contextTimeSec: 0, performanceTimeMs: 0 })).toBe(false);
    expect(clock.addSample({ contextTimeSec: Number.NaN, performanceTimeMs: 10 })).toBe(false);
    expect(clock.isReady).toBe(false);
    expect(() => clock.heardAtMs(1)).toThrow();
  });

  it('forgets old readings beyond its capacity so it can follow a device change', () => {
    const clock = new OutputClock(5);
    for (let i = 1; i <= 5; i += 1) {
      clock.addSample({ contextTimeSec: i, performanceTimeMs: i * 1000 + 100 });
    }
    for (let i = 6; i <= 10; i += 1) {
      clock.addSample({ contextTimeSec: i, performanceTimeMs: i * 1000 + 300 });
    }
    expect(clock.heardAtMs(20)).toBeCloseTo(20_300, 6);
  });

  it('can be seeded from the reported output latency when timestamps are unavailable', () => {
    const clock = new OutputClock();
    // Right now (performance 8000 ms) the context is rendering 3.0 s; output latency is 25 ms.
    clock.addSample(outputTimestampFromLatency(3, 8000, 0.025));
    expect(clock.heardAtMs(3)).toBeCloseTo(8025, 6);
  });
});

describe('vocal latency', () => {
  const latency = { inputSec: 0.012, outputSec: 0.02, processingSec: 0.006 };

  it('is the full round trip the voice takes relative to the backing track', () => {
    expect(computeVocalLatencySec(latency, 0)).toBeCloseTo(0.038, 9);
    expect(computeMonitoringLatencySec(latency)).toBeCloseTo(0.038, 9);
  });

  it('applies the user fine-tune with "positive = vocal later"', () => {
    // Later vocal = less compensation.
    expect(computeVocalLatencySec(latency, 10)).toBeCloseTo(0.028, 9);
    expect(computeVocalLatencySec(latency, -10)).toBeCloseTo(0.048, 9);
  });
});

describe('CameraLatencyEstimator', () => {
  it('reports a typical latency until it has real measurements', () => {
    const estimator = new CameraLatencyEstimator();
    expect(estimator.hasMeasurement).toBe(false);
    expect(estimator.latencyMs).toBe(DEFAULT_CAMERA_LATENCY_MS);
    estimator.addFrame(undefined, 100);
    expect(estimator.hasMeasurement).toBe(false);
  });

  it('uses the median of plausible readings and discards glitches', () => {
    const estimator = new CameraLatencyEstimator();
    const latencies = [48, 50, 52, 49, 51, 50, 900, -20, 50];
    latencies.forEach((latency, index) => {
      const captureTimeMs = 1000 + index * 33;
      estimator.addFrame(captureTimeMs, captureTimeMs + latency);
    });
    expect(estimator.hasMeasurement).toBe(true);
    expect(estimator.latencyMs).toBe(50);
  });
});

describe('video start offset', () => {
  it('places the first video frame on the audio timeline', () => {
    const clock = new OutputClock();
    clock.addSample({ contextTimeSec: 10, performanceTimeMs: 20_000 });

    // Audio capture began with the frame rendered at 10.5 s, which is heard at 20 500 ms.
    // The recorder started at 20 400 ms; at 30 fps with 60 ms of camera latency its first
    // frame was captured around 20 400 + 16.67 - 60 = 20 356.67 ms.
    const firstFrameCaptureMs = estimateFirstFrameCaptureMs({
      recorderStartedMs: 20_400,
      frameIntervalMs: 1000 / 30,
      cameraLatencyMs: 60,
    });
    expect(firstFrameCaptureMs).toBeCloseTo(20_356.667, 2);

    const offset = computeVideoStartOffsetSec({
      firstFrameCaptureMs,
      captureStartContextSec: 10.5,
      clock,
      userOffsetMs: 0,
    });
    // The video starts 143.33 ms BEFORE the first captured audio was heard.
    expect(offset).toBeCloseTo(-0.143333, 5);
  });

  it('applies the user fine-tune with "positive = picture later"', () => {
    const clock = new OutputClock();
    clock.addSample({ contextTimeSec: 1, performanceTimeMs: 1000 });
    const base = { firstFrameCaptureMs: 2000, captureStartContextSec: 2, clock };
    expect(computeVideoStartOffsetSec({ ...base, userOffsetMs: 0 })).toBeCloseTo(0, 9);
    expect(computeVideoStartOffsetSec({ ...base, userOffsetMs: 25 })).toBeCloseTo(0.025, 9);
  });

  it('keeps a clap aligned end to end through the manifest clock model', () => {
    // A clap happens at wall time 30 000 ms. The camera sees it; the microphone hears it.
    const clapWallMs = 30_000;
    const latency = { inputSec: 0.01, outputSec: 0.03, processingSec: 0.005 };
    const clock = new OutputClock();
    // Context time c is heard at c*1000 + 5000 ms.
    clock.addSample({ contextTimeSec: 1, performanceTimeMs: 6000 });

    const captureStartContextSec = 24; // heard at W0 = 29 000 ms
    const firstFrameCaptureMs = 29_200;
    const startOffsetSec = computeVideoStartOffsetSec({
      firstFrameCaptureMs,
      captureStartContextSec,
      clock,
      userOffsetMs: 0,
    });
    const vocalLatencySec = computeVocalLatencySec(latency, 0);

    // The clap is rendered into the graph inputSec + processingSec after it happened, at
    // context time (clapWall - offset)/1000 - outputSec + inputSec + processingSec ... which
    // in stem time (seconds since capture start) is:
    const graphArrivalWallMs = clapWallMs + (latency.inputSec + latency.processingSec) * 1000;
    const contextAtArrival = clock.contextTimeHeardAt(graphArrivalWallMs) + latency.outputSec;
    const clapStemTimeSec = contextAtArrival - captureStartContextSec;

    // Manifest model: output time t plays vocal[t + S + vocalLatency].
    const clapOutputTimeSec = clapStemTimeSec - startOffsetSec - vocalLatencySec;
    // In the video, the clap frame sits (clapWall - firstFrameCapture) after the first frame.
    const clapVideoTimeSec = (clapWallMs - firstFrameCaptureMs) / 1000;

    expect(clapOutputTimeSec).toBeCloseTo(clapVideoTimeSec, 9);
  });
});

describe('ElapsedTimer', () => {
  it('excludes paused time', () => {
    const timer = new ElapsedTimer();
    timer.start(1000);
    expect(timer.elapsedMs(1500)).toBe(500);
    timer.pause(2000);
    expect(timer.isRunning).toBe(false);
    expect(timer.elapsedMs(5000)).toBe(1000);
    timer.resume(6000);
    expect(timer.elapsedMs(6250)).toBe(1250);
  });

  it('ignores a pause when it is not running and a resume when it already is', () => {
    const timer = new ElapsedTimer();
    timer.pause(100);
    expect(timer.elapsedMs(200)).toBe(0);
    timer.start(1000);
    timer.resume(1500);
    expect(timer.elapsedMs(2000)).toBe(1000);
  });
});
