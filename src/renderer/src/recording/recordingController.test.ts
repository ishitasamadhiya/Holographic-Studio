import { describe, expect, it } from 'vitest';
import { createInitialStudioState } from '@renderer/state/staticStudio';
import type { Notice, RecordingState } from '@renderer/state/studioTypes';
import { createAppError, ok } from '@shared/errors';
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings';
import type { TakeManifest } from '@shared/take';
import {
  BACKING_LEAD_SEC,
  BACKING_TAIL_MS,
  CAPTURE_LEAD_SEC,
  RecordingController,
  TRANSITION_LEAD_SEC,
  type CameraFeed,
} from './recordingController';
import {
  computeVideoStartOffsetSec,
  computeVocalLatencySec,
  estimateFirstFrameCaptureMs,
} from './syncTimeline';
import { deferred, exportFailure, FakeHoloApi } from './testing/fakeApi';
import { FakeClock } from './testing/fakeClock';
import { FAKE_LATENCY, FakeEngine } from './testing/fakeEngine';
import { FakeVideoRecorderFactory } from './testing/fakeVideoRecorder';

const SAMPLE_RATE = 48000;
const ARTWORK = new Uint8Array([137, 80, 78, 71]).buffer;

interface HarnessOptions {
  mode?: Settings['mode'];
  countdown?: boolean;
  backing?: boolean;
  camera?: CameraFeed | null;
}

function cameraFeed(): CameraFeed {
  return { stream: {} as MediaStream, width: 1920, height: 1080, frameRate: 30, latencyMs: 60 };
}

function setup(options: HarnessOptions = {}) {
  const clock = new FakeClock();
  const engine = new FakeEngine(clock);
  engine.running = true;
  if (options.backing !== false) engine.hasBackingTrack = true;
  const api = new FakeHoloApi();
  const recorders = new FakeVideoRecorderFactory(clock);
  const settings: Settings = structuredClone(DEFAULT_SETTINGS);
  settings.mode = options.mode ?? 'video';
  settings.recording.countdownEnabled = options.countdown ?? false;
  settings.sync = { vocalOffsetMs: 5, videoOffsetMs: -10 };
  const camera = options.camera === undefined ? cameraFeed() : options.camera;
  let state: RecordingState = createInitialStudioState().recording;
  const statuses: string[] = [];
  const notices: Array<Pick<Notice, 'kind' | 'message'>> = [];
  const artworkRequests: unknown[] = [];
  let takeStarts = 0;

  const controller = new RecordingController({
    api: api.api,
    engine,
    clock,
    videoRecorders: recorders,
    renderTakeArtwork: async (info) => {
      artworkRequests.push(info);
      return ARTWORK;
    },
    now: () => new Date(2026, 9, 5, 14, 30),
    getSettings: () => settings,
    getCameraFeed: () => camera,
    getCameraError: () => null,
    getBackingTrackName: () => 'My Song.mp3',
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
      if (patch.status && patch.status !== statuses.at(-1)) statuses.push(patch.status);
    },
    notify: (kind, message) => notices.push({ kind, message }),
    onTakeStarting: () => {
      takeStarts += 1;
    },
  });

  /** Records `seconds` of audio in one-second blocks, moving the clock along with it. */
  const recordFor = async (seconds: number): Promise<void> => {
    for (let second = 0; second < seconds; second++) {
      engine.emitChunk(SAMPLE_RATE);
      await clock.advance(1000);
    }
  };

  const startRecording = async (): Promise<void> => {
    await controller.start();
    expect(state.status).toBe('recording');
  };

  /** Runs one async controller action to completion while the clock keeps moving. */
  const settle = async <T>(work: Promise<T>): Promise<T> => {
    let done = false;
    const result = work.finally(() => {
      done = true;
    });
    for (let step = 0; step < 100 && !done; step++) await clock.advance(50);
    return result;
  };

  const lastManifest = (): TakeManifest => {
    const manifest = api.finished.at(-1)?.manifest;
    if (!manifest) throw new Error('No take was finished');
    return manifest;
  };

  return {
    clock,
    engine,
    api,
    recorders,
    settings,
    controller,
    statuses,
    notices,
    artworkRequests,
    get state() {
      return state;
    },
    get takeStarts() {
      return takeStarts;
    },
    recordFor,
    startRecording,
    settle,
    lastManifest,
  };
}

describe('starting a take', () => {
  it('opens the take, starts the camera recorder, then schedules capture and backing', async () => {
    const h = setup();
    const startedAt = h.engine.currentTimeSec;
    await h.startRecording();

    expect(h.api.callsNamed('take.begin')).toEqual([
      [
        {
          mode: 'video',
          sampleRate: SAMPLE_RATE,
          video: {
            mimeType: 'video/x-matroska;codecs=avc1',
            width: 1920,
            height: 1080,
            frameRate: 30,
          },
        },
      ],
    ]);
    expect(h.recorders.latest.options.videoBitsPerSecond).toBe(16_000_000);
    expect(h.recorders.latest.events.map((event) => event.name)).toEqual(['start']);

    const captureAt = startedAt + CAPTURE_LEAD_SEC;
    const engineCalls = h.engine.calls.map((call) => call.name);
    expect(engineCalls).toEqual(['startCapture', 'startBacking']);
    expect(h.engine.callsNamed('startCapture')[0]?.[0]).toBeCloseTo(captureAt, 9);
    const backing = h.engine.callsNamed('startBacking')[0]?.[0] as {
      offsetSec: number;
      atContextTimeSec: number;
    };
    expect(backing.offsetSec).toBe(0);
    expect(backing.atContextTimeSec).toBeCloseTo(captureAt + BACKING_LEAD_SEC, 9);
    expect(h.statuses).toEqual(['idle', 'recording']);
    expect(h.takeStarts).toBe(1);
  });

  it('waits for the camera recorder to really start before the audio capture is scheduled', async () => {
    const h = setup();
    h.recorders.holdStart = true;
    const starting = h.controller.start();
    await h.clock.advance(100);
    expect(h.engine.callsNamed('startCapture')).toHaveLength(0);
    h.recorders.latest.confirmStart();
    await starting;
    expect(h.engine.callsNamed('startCapture')).toHaveLength(1);
  });

  it('records 720p at 8 Mbit/s and falls back to VP8 when H.264 is not available', async () => {
    const h = setup({ camera: { ...cameraFeed(), width: 1280, height: 720 } });
    h.recorders.supportedTypes = ['video/webm;codecs=vp8'];
    await h.startRecording();
    expect(h.recorders.latest.options).toMatchObject({
      mimeType: 'video/webm;codecs=vp8',
      videoBitsPerSecond: 8_000_000,
    });
  });

  it('does not start the backing track when there is none (a cappella)', async () => {
    const h = setup({ backing: false });
    await h.startRecording();
    expect(h.engine.callsNamed('startBacking')).toHaveLength(0);
  });

  it('counts down one tick per second, then records', async () => {
    const h = setup({ countdown: true });
    const starting = h.controller.start();
    await h.clock.advance(0);
    expect(h.state).toMatchObject({ status: 'countdown', countdownRemaining: 3 });
    await h.clock.advance(1000);
    expect(h.state.countdownRemaining).toBe(2);
    await h.clock.advance(1000);
    expect(h.state.countdownRemaining).toBe(1);
    expect(h.api.callsNamed('take.begin')).toHaveLength(0);
    await h.clock.advance(1000);
    await starting;
    expect(h.state).toMatchObject({ status: 'recording', countdownRemaining: 0 });
  });

  it('discarding during the countdown cancels it without opening a take', async () => {
    const h = setup({ countdown: true });
    const starting = h.controller.start();
    await h.clock.advance(1000);
    await h.controller.discard();
    await starting;
    expect(h.state.status).toBe('idle');
    expect(h.api.callsNamed('take.begin')).toHaveLength(0);
    expect(h.clock.pendingTimerCount).toBe(0);
  });

  it('does not open a take when live audio broke during the countdown', async () => {
    const h = setup({ countdown: true });
    const starting = h.controller.start();
    await h.clock.advance(1000);
    h.engine.fault = createAppError('audio-engine-failed', 'The vocal chain failed');
    await h.clock.advance(2000);
    await starting;
    expect(h.state).toMatchObject({ status: 'idle', error: { code: 'audio-engine-failed' } });
    expect(h.api.callsNamed('take.begin')).toHaveLength(0);
  });

  it('refuses to start without a running engine or a camera in video mode', async () => {
    const h = setup();
    h.engine.running = false;
    await h.controller.start();
    expect(h.state.status).toBe('idle');
    expect(h.notices).toHaveLength(1);

    // Running, but the microphone is gone: nothing could be recorded.
    const broken = setup();
    broken.engine.fault = createAppError('device-disconnected', 'The microphone track ended');
    await broken.controller.start();
    expect(broken.state.status).toBe('idle');
    expect(broken.notices).toEqual([
      { kind: 'warning', message: createAppError('device-disconnected').message },
    ]);
    expect(broken.api.callsNamed('take.begin')).toHaveLength(0);

    const noCamera = setup({ camera: null });
    await noCamera.controller.start();
    expect(noCamera.state).toMatchObject({ status: 'idle', error: { code: 'no-camera' } });
    expect(noCamera.api.callsNamed('take.begin')).toHaveLength(0);
  });

  it('reports a take that cannot be opened and stays idle', async () => {
    const h = setup();
    h.api.beginResult = { ok: false, error: createAppError('recording-failed', 'disk full') };
    await h.controller.start();
    expect(h.state).toMatchObject({ status: 'idle', error: { code: 'recording-failed' } });
    expect(h.notices.at(-1)?.kind).toBe('error');
    expect(h.recorders.created).toHaveLength(0);
  });
});

describe('while recording', () => {
  it('forwards audio and video chunks to the take in the order they were produced', async () => {
    const h = setup();
    await h.startRecording();
    h.engine.emitChunk(128);
    h.recorders.latest.emitChunk();
    h.engine.emitChunk(256);
    h.recorders.latest.emitChunk();
    expect(
      h.api.appendedAudio.map(({ takeId, chunk }) => [takeId, new Float32Array(chunk.vocal)[0]]),
    ).toEqual([
      ['take-1', 1],
      ['take-1', 2],
    ]);
    expect(h.api.appendedVideo.map(({ chunk }) => new Uint8Array(chunk)[0])).toEqual([1, 2]);
  });

  it('pauses capture, backing and picture at one audio-clock moment and resumes where it stopped', async () => {
    const h = setup();
    await h.startRecording();
    await h.recordFor(2);
    h.engine.calls.length = 0;

    const pauseRequestedAt = h.engine.currentTimeSec;
    h.controller.togglePause();
    expect(h.state.status).toBe('paused');
    await h.clock.advance(500);
    const pauseAt = pauseRequestedAt + TRANSITION_LEAD_SEC;
    expect(h.engine.callsNamed('pauseCapture')[0]?.[0]).toBeCloseTo(pauseAt, 9);
    expect(h.engine.callsNamed('stopBacking')[0]?.[0]).toBeCloseTo(pauseAt, 9);
    // The picture pauses when that moment has been heard and filmed: output + camera latency.
    const pauseEvent = h.recorders.latest.events.find((event) => event.name === 'pause');
    const heardAtMs = h.engine.outputClock.heardAtMs(pauseAt);
    expect(pauseEvent?.atMs).toBeCloseTo(heardAtMs + 60, 6);

    await h.clock.advance(3000);
    expect(h.controller.elapsedSec(h.clock.nowMs())).toBeCloseTo(2, 6);

    h.engine.calls.length = 0;
    const resumeRequestedAt = h.engine.currentTimeSec;
    h.controller.togglePause();
    expect(h.state.status).toBe('recording');
    await h.clock.advance(500);
    const resumeAt = resumeRequestedAt + TRANSITION_LEAD_SEC;
    expect(h.engine.callsNamed('resumeCapture')[0]?.[0]).toBeCloseTo(resumeAt, 9);
    expect(h.engine.callsNamed('startBacking')[0]?.[0]).toEqual({
      offsetSec: h.engine.backingPositionSec,
      atContextTimeSec: resumeAt,
    });
    expect(h.recorders.latest.events.map((event) => event.name)).toEqual([
      'start',
      'pause',
      'resume',
    ]);
    expect(h.controller.elapsedSec(h.clock.nowMs())).toBeCloseTo(2.5, 6);

    await h.recordFor(1);
    await h.settle(h.controller.stop());
    expect(h.lastManifest().diagnostics?.pauses).toBe(1);
  });

  it('keeps a short tail after the backing track ends, then stops by itself', async () => {
    const h = setup();
    await h.startRecording();
    await h.recordFor(3);
    h.engine.endBacking();
    await h.clock.advance(BACKING_TAIL_MS - 100);
    expect(h.state.status).toBe('recording');
    await h.clock.advance(200);
    await h.settle(Promise.resolve());
    expect(h.state.status).toBe('review');
    expect(h.api.finished).toHaveLength(1);
  });

  it('finishes the take normally when a device is lost mid-take', async () => {
    const h = setup();
    await h.startRecording();
    await h.recordFor(2);
    await h.settle(h.controller.finishAfterDeviceLoss());
    expect(h.state).toMatchObject({ status: 'review', takeDurationSec: 2 });
    expect(h.api.discarded).toHaveLength(0);
  });

  it('keeps the take when the camera recorder fails midway', async () => {
    const h = setup();
    await h.startRecording();
    await h.recordFor(2);
    h.recorders.latest.failMidway();
    await h.settle(Promise.resolve());
    expect(h.state.status).toBe('review');
    expect(h.notices.at(-1)?.kind).toBe('warning');
  });
});

describe('stopping', () => {
  it('flushes everything and stores a manifest built from the measured timing', async () => {
    const h = setup();
    const startedAtMs = h.clock.nowMs();
    const captureAt = h.engine.currentTimeSec + CAPTURE_LEAD_SEC;
    await h.startRecording();
    await h.recordFor(5);
    h.engine.calls.length = 0;
    await h.settle(h.controller.stop());

    expect(h.engine.calls.map((call) => call.name)).toEqual(['stopBacking', 'stopCapture']);
    expect(h.recorders.latest.events.at(-1)?.name).toBe('stop');
    expect(h.statuses).toEqual(['idle', 'recording', 'finishing', 'review']);
    expect(h.state.takeDurationSec).toBe(5);

    const manifest = h.lastManifest();
    const vocalLatencySec = computeVocalLatencySec(FAKE_LATENCY, 5);
    expect(vocalLatencySec).toBeCloseTo(0.03, 9);
    const startOffsetSec = computeVideoStartOffsetSec({
      firstFrameCaptureMs: estimateFirstFrameCaptureMs({
        recorderStartedMs: startedAtMs,
        frameIntervalMs: 1000 / 30,
        cameraLatencyMs: 60,
      }),
      captureStartContextSec: captureAt,
      clock: h.engine.outputClock,
      userOffsetMs: -10,
    });
    // Recorder started 100 ms before the audio was heard: 1000 + 16.7 - 60 - (1000 + 80 + 20) - 10.
    expect(startOffsetSec).toBeCloseTo(-0.1533, 4);
    expect(manifest).toEqual({
      mode: 'video',
      sampleRate: SAMPLE_RATE,
      audioFrames: 5 * SAMPLE_RATE,
      vocalLatencySec: expect.closeTo(vocalLatencySec, 9),
      hasBacking: true,
      video: {
        startOffsetSec: expect.closeTo(startOffsetSec, 9),
        durationSec: expect.any(Number),
        width: 1920,
        height: 1080,
        frameRate: 30,
      },
      diagnostics: {
        inputLatencySec: 0.01,
        outputLatencySec: 0.02,
        processingLatencySec: 0.005,
        cameraLatencySec: 0.06,
        pauses: 0,
      },
    });
    expect(manifest.video?.durationSec).toBeGreaterThan(4.9);
    expect(manifest.video?.durationSec).toBeLessThanOrEqual(5);
  });

  it('builds an audio-only manifest without video', async () => {
    const h = setup({ mode: 'audio', camera: null });
    await h.startRecording();
    expect(h.api.callsNamed('take.begin')[0]?.[0]).toEqual({
      mode: 'audio',
      sampleRate: SAMPLE_RATE,
    });
    expect(h.recorders.created).toHaveLength(0);
    await h.recordFor(2);
    await h.settle(h.controller.stop());
    expect(h.lastManifest().video).toBeUndefined();
    expect(h.lastManifest().mode).toBe('audio');
  });

  it('quietly drops a take shorter than half a second', async () => {
    const h = setup();
    await h.startRecording();
    h.engine.emitChunk(SAMPLE_RATE / 4);
    await h.settle(h.controller.stop());
    expect(h.state.status).toBe('idle');
    expect(h.state.error).toBeNull();
    expect(h.api.finished).toHaveLength(0);
    expect(h.api.discarded).toEqual(['take-1']);
    expect(h.notices).toHaveLength(0);
  });

  it('discards the take and reports a failure when it cannot be finished', async () => {
    const h = setup();
    await h.startRecording();
    await h.recordFor(2);
    h.api.finishResult = { ok: false, error: createAppError('recording-failed', 'write failed') };
    await h.settle(h.controller.stop());
    expect(h.state).toMatchObject({ status: 'idle', error: { code: 'recording-failed' } });
    expect(h.api.discarded).toEqual(['take-1']);
    expect(h.notices.at(-1)?.kind).toBe('error');
  });

  it('uses the frames already delivered when the engine stops answering', async () => {
    const h = setup();
    await h.startRecording();
    await h.recordFor(2);
    h.engine.hangStopCapture = true;
    await h.settle(h.controller.stop());
    expect(h.state.status).toBe('review');
    expect(h.lastManifest().audioFrames).toBe(2 * SAMPLE_RATE);
  });
});

describe('discarding and recording again', () => {
  it('discarding while recording stops everything and deletes the take', async () => {
    const h = setup();
    await h.startRecording();
    await h.recordFor(1);
    await h.settle(h.controller.discard());
    expect(h.state.status).toBe('idle');
    expect(h.engine.callsNamed('stopCapture')).toHaveLength(1);
    expect(h.recorders.latest.events.at(-1)?.name).toBe('stop');
    expect(h.api.discarded).toEqual(['take-1']);
    expect(h.engine.listenerCounts.stems).toBe(0);
  });

  it('discarding a take under review deletes it', async () => {
    const h = setup();
    await h.startRecording();
    await h.recordFor(2);
    await h.settle(h.controller.stop());
    await h.controller.discard();
    expect(h.state.status).toBe('idle');
    expect(h.api.discarded).toEqual(['take-1']);
  });

  it('recordAnother returns to idle and deletes the temporary take', async () => {
    const h = setup();
    await h.startRecording();
    await h.recordFor(2);
    await h.settle(h.controller.stop());
    await h.controller.save();
    expect(h.state.status).toBe('saved');
    h.controller.recordAnother();
    await h.clock.advance(0);
    expect(h.state).toMatchObject({ status: 'idle', savedPath: null });
    expect(h.api.discarded).toEqual(['take-1']);
  });
});

describe('saving', () => {
  async function reviewedTake(mode: Settings['mode'] = 'video') {
    const h = setup({ mode, camera: mode === 'video' ? cameraFeed() : null });
    await h.startRecording();
    await h.recordFor(2);
    await h.settle(h.controller.stop());
    expect(h.state.status).toBe('review');
    return h;
  }

  it('stays in review when the save dialog is cancelled', async () => {
    const h = await reviewedTake();
    h.api.savePath = null;
    await h.controller.save();
    expect(h.state.status).toBe('review');
    expect(h.api.exportRequests).toHaveLength(0);
    expect(h.api.callsNamed('exporter.chooseSavePath')).toEqual([
      ['Holographic-Studio-Take-2026-10-05-1430.mp4'],
    ]);
  });

  it('exports with progress and ends in saved', async () => {
    const h = await reviewedTake();
    h.api.exportOutcome = deferred();
    const saving = h.controller.save();
    await h.clock.advance(0);
    expect(h.state).toMatchObject({
      status: 'exporting',
      exportStage: 'mixing',
      exportProgress: 0,
    });
    h.api.emitProgress({ takeId: 'take-1', stage: 'encoding', fraction: 0.6 });
    h.api.emitProgress({ takeId: 'some-other-take', stage: 'finishing', fraction: 0.9 });
    expect(h.state).toMatchObject({ exportStage: 'encoding', exportProgress: 0.6 });
    h.api.exportOutcome.resolve(
      ok({ outputPath: '/Users/singer/Movies/take.mp4', durationSec: 2, sizeBytes: 10 }),
    );
    await saving;
    expect(h.state).toMatchObject({ status: 'saved', savedPath: '/Users/singer/Movies/take.mp4' });
    expect(h.api.exportRequests[0]).toEqual({
      takeId: 'take-1',
      outputPath: '/Users/singer/Movies/take.mp4',
    });
    expect(h.api.progressListenerCount).toBe(0);

    h.controller.openSavedFile();
    h.controller.showSavedInFolder();
    await h.clock.advance(0);
    expect(h.api.callsNamed('exporter.openFile')).toEqual([['/Users/singer/Movies/take.mp4']]);
    expect(h.api.callsNamed('exporter.showInFolder')).toEqual([['/Users/singer/Movies/take.mp4']]);
  });

  it('passes artwork for an Audio Only take', async () => {
    const h = await reviewedTake('audio');
    await h.controller.save();
    expect(h.api.exportRequests[0]?.artworkPng).toBe(ARTWORK);
    expect(h.artworkRequests).toEqual([
      { backingTrackName: 'My Song.mp3', date: new Date(2026, 9, 5, 14, 30) },
    ]);
  });

  it('returns to review with the error when the export fails, so saving can be retried', async () => {
    const h = await reviewedTake();
    h.api.exportOutcome = deferred();
    const saving = h.controller.save();
    h.api.exportOutcome.resolve(exportFailure());
    await saving;
    expect(h.state).toMatchObject({ status: 'review', error: { code: 'export-failed' } });

    h.api.exportOutcome = null;
    await h.controller.save();
    expect(h.state).toMatchObject({ status: 'saved', error: null });
  });

  it('returns to review silently when the export is cancelled', async () => {
    const h = await reviewedTake();
    h.api.exportOutcome = deferred();
    const saving = h.controller.save();
    await h.clock.advance(0);
    h.controller.cancelExport();
    await h.clock.advance(0);
    expect(h.api.callsNamed('exporter.cancel')).toEqual([['take-1']]);
    h.api.exportOutcome.resolve({ ok: false, error: createAppError('export-cancelled') });
    await saving;
    expect(h.state).toMatchObject({ status: 'review', error: null });
    expect(h.notices).toHaveLength(0);
  });
});

describe('illegal transitions', () => {
  it('ignores actions that do not apply to the current status', async () => {
    const h = setup();
    h.controller.togglePause();
    await h.controller.stop();
    await h.controller.save();
    h.controller.recordAnother();
    h.controller.cancelExport();
    expect(h.state.status).toBe('idle');
    expect(h.api.log).toHaveLength(0);

    await h.startRecording();
    await h.controller.start();
    await h.controller.save();
    expect(h.api.callsNamed('take.begin')).toHaveLength(1);
    expect(h.state.status).toBe('recording');

    await h.recordFor(2);
    await h.settle(h.controller.stop());
    h.api.exportOutcome = deferred();
    const saving = h.controller.save();
    await h.clock.advance(0);
    expect(h.state.status).toBe('exporting');
    await h.controller.start();
    await h.controller.discard();
    h.controller.togglePause();
    expect(h.state.status).toBe('exporting');
    expect(h.api.callsNamed('take.begin')).toHaveLength(1);
    h.api.exportOutcome.resolve(ok({ outputPath: '/x.mp4', durationSec: 2, sizeBytes: 1 }));
    await saving;
  });

  it('reports a take as in progress from the countdown until it is finished', async () => {
    const h = setup({ countdown: true });
    expect(h.controller.isTakeInProgress).toBe(false);
    const starting = h.controller.start();
    expect(h.controller.isTakeInProgress).toBe(true);
    await h.clock.advance(3000);
    await starting;
    expect(h.controller.isTakeInProgress).toBe(true);
    await h.recordFor(1);
    await h.settle(h.controller.stop());
    expect(h.controller.isTakeInProgress).toBe(false);
  });

  it('releases every listener and deletes temporary takes when disposed', async () => {
    const h = setup();
    await h.startRecording();
    await h.recordFor(1);
    await h.settle(h.controller.dispose());
    expect(h.engine.listenerCounts).toEqual({ stems: 0, backingEnded: 0, errors: 0 });
    expect(h.api.discarded).toEqual(['take-1']);
  });
});
