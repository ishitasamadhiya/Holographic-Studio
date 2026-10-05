import { describe, expect, it } from 'vitest';
import { createAppError, fail } from '@shared/errors';
import { mergeSettings } from '@shared/settingsSchema';
import { CALIBRATION_MS, TAKE_IN_PROGRESS_MESSAGE } from './createStudio';
import { syntheticFrame, syntheticHand } from '@gestures/testing/syntheticHand';
import { referenceAnalysis } from './testing/fakeEnvironment';
import { createStudioHarness } from './testing/studioHarness';

const IN_STUDIO = { onboardingComplete: true } as const;

describe('initialize', () => {
  it('starts a fresh profile in the wizard without opening any device', async () => {
    const h = createStudioHarness();
    await h.actions.initialize();
    expect(h.state()).toMatchObject({
      phase: 'wizard',
      appInfo: { isE2E: false },
      permissions: { microphone: 'granted', camera: 'granted' },
      engine: { status: 'off' },
      camera: { status: 'off' },
    });
    expect(h.engine.callsNamed('start')).toHaveLength(0);
    expect(h.mediaDevices.requests).toHaveLength(0);
  });

  it('lists real devices only, without the default and communications aliases', async () => {
    const h = createStudioHarness();
    await h.actions.initialize();
    expect(h.state().devices).toEqual({
      microphones: [
        { id: 'mic-1', label: 'Built-in Microphone' },
        { id: 'mic-2', label: 'USB Microphone' },
      ],
      cameras: [{ id: 'cam-1', label: 'FaceTime HD Camera' }],
      outputs: [{ id: 'out-1', label: 'Headphones' }],
      outputSelectionSupported: true,
    });
  });

  it('goes straight to the studio once onboarding is complete, with audio and camera on', async () => {
    const h = createStudioHarness({ ...IN_STUDIO, devices: { microphoneId: 'mic-2' } });
    await h.actions.initialize();
    expect(h.state()).toMatchObject({
      phase: 'studio',
      engine: { status: 'running', error: null, monitoringLatencyMs: 35 },
      camera: { status: 'running', width: 1920, height: 1080 },
    });
    expect(h.engine.callsNamed('start')).toEqual([[{ microphoneId: 'mic-2', outputId: null }]]);
    expect(h.mediaDevices.requests[0]?.video).toMatchObject({
      width: { exact: 1920 },
      height: { exact: 1080 },
      frameRate: { ideal: 30 },
    });
  });

  it('leaves the camera off in Audio Only mode', async () => {
    const h = createStudioHarness({ ...IN_STUDIO, mode: 'audio' });
    await h.actions.initialize();
    expect(h.state().engine.status).toBe('running');
    expect(h.state().camera.status).toBe('off');
    expect(h.mediaDevices.requests).toHaveLength(0);
  });

  it('completing onboarding enters the studio and starts audio and camera', async () => {
    const h = createStudioHarness();
    await h.actions.initialize();
    h.actions.completeOnboarding();
    await h.settle();
    expect(h.state()).toMatchObject({
      phase: 'studio',
      engine: { status: 'running' },
      camera: { status: 'running' },
      settings: { onboardingComplete: true },
    });
    expect(h.api.storedSettings.onboardingComplete).toBe(true);
  });

  it('silently restores the last session songs that still exist', async () => {
    const h = createStudioHarness({
      ...IN_STUDIO,
      lastSession: { backingPath: '/songs/backing.wav', referencePath: '/songs/gone.mp3' },
    });
    await h.actions.initialize();
    await h.settle();
    expect(h.state().backing).toMatchObject({ status: 'ready', file: { name: 'backing.wav' } });
    expect(h.state().reference.status).toBe('none');
    expect(h.state().notices).toEqual([]);
  });
});

describe('permissions', () => {
  it('reports a denied microphone without trying to open it', async () => {
    const h = createStudioHarness(IN_STUDIO);
    h.api.permissionStatus.microphone = 'denied';
    await h.actions.initialize();
    expect(h.state().engine).toMatchObject({
      status: 'error',
      error: { code: 'microphone-permission-denied' },
    });
    expect(h.engine.callsNamed('start')).toHaveLength(0);
    expect(h.state().notices.map((notice) => notice.kind)).toContain('error');
  });

  it('asks for camera access when undecided and respects a refusal', async () => {
    const h = createStudioHarness(IN_STUDIO);
    h.api.permissionStatus.camera = 'not-determined';
    h.api.permissionAnswer.camera = 'denied';
    await h.actions.initialize();
    expect(h.api.callsNamed('permissions.request')).toEqual([['camera']]);
    expect(h.state().camera).toMatchObject({
      status: 'error',
      error: { code: 'camera-permission-denied' },
    });
    expect(h.state().permissions.camera).toBe('denied');
    expect(h.mediaDevices.requests).toHaveLength(0);
  });

  it('refreshes the device list once access is granted', async () => {
    const h = createStudioHarness();
    h.mediaDevices.devices = h.mediaDevices.devices.map((device) => ({
      ...device,
      deviceId: '',
      label: '',
    }));
    await h.actions.initialize();
    expect(h.state().devices.microphones).toEqual([]);
    h.mediaDevices.devices = [{ deviceId: 'mic-1', kind: 'audioinput', label: 'Mic' }];
    await expect(h.actions.requestPermission('microphone')).resolves.toBe('granted');
    expect(h.state().devices.microphones).toEqual([{ id: 'mic-1', label: 'Mic' }]);
  });
});

describe('devices', () => {
  it('falls back to the default microphone when the selected one disappears', async () => {
    const h = createStudioHarness({ ...IN_STUDIO, devices: { microphoneId: 'mic-2' } });
    await h.actions.initialize();
    h.mediaDevices.devices = h.mediaDevices.devices.filter((device) => device.deviceId !== 'mic-2');
    h.mediaDevices.emitDeviceChange();
    await h.settle();
    expect(h.state().devices.microphones.map((option) => option.id)).toEqual(['mic-1']);
    expect(h.state().settings.devices.microphoneId).toBeNull();
    expect(h.engine.callsNamed('setMicrophone')).toEqual([[null]]);
    expect(h.state().notices.at(-1)).toMatchObject({ kind: 'warning' });
  });

  it('opens the default camera when the remembered one is gone, and says so', async () => {
    const h = createStudioHarness({ ...IN_STUDIO, devices: { cameraId: 'cam-gone' } });
    h.mediaDevices.devices = h.mediaDevices.devices.map((device) => ({ ...device, label: '' }));
    await h.actions.initialize();
    expect(h.state().camera.status).toBe('running');
    expect(h.state().settings.devices.cameraId).toBeNull();
    expect(h.state().notices.some((notice) => notice.message.includes('camera'))).toBe(true);
  });

  it('steps the camera down to 720p when it cannot deliver 1080p', async () => {
    const h = createStudioHarness(IN_STUDIO);
    h.mediaDevices.cameraSize = { width: 1280, height: 720 };
    await h.actions.initialize();
    expect(h.state().camera).toMatchObject({ status: 'running', width: 1280, height: 720 });
  });

  it('switches devices on request, but not while a take is in progress', async () => {
    const h = createStudioHarness({ ...IN_STUDIO, mode: 'audio' });
    await h.actions.initialize();
    await h.actions.selectMicrophone('mic-2');
    await h.actions.selectOutput('out-1');
    expect(h.engine.callsNamed('setMicrophone')).toEqual([['mic-2']]);
    expect(h.engine.callsNamed('setOutput')).toEqual([['out-1']]);

    h.state().settings.recording.countdownEnabled = false;
    await h.actions.startRecording();
    expect(h.state().recording.status).toBe('recording');
    await h.actions.selectMicrophone('mic-1');
    await h.actions.setMode('video');
    h.actions.updateSettings({ devices: { outputId: null }, audio: { backingVolume: 0.3 } });
    await h.settle();
    expect(h.engine.callsNamed('setMicrophone')).toEqual([['mic-2']]);
    expect(h.state().settings).toMatchObject({
      mode: 'audio',
      devices: { microphoneId: 'mic-2', outputId: 'out-1' },
      audio: { backingVolume: 0.3 },
    });
    expect(h.state().notices.at(-1)?.message).toBe(TAKE_IN_PROGRESS_MESSAGE);
  });

  it('restarts the camera when its device or resolution changes', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.actions.initialize();
    h.actions.updateSettings({ video: { resolution: '720p' } });
    await h.settle();
    expect(h.mediaDevices.requests).toHaveLength(2);
    expect(h.state().camera).toMatchObject({ status: 'running', width: 1280, height: 720 });
    expect(h.mediaDevices.tracks[0]?.stopped).toBe(true);
  });
});

describe('settings', () => {
  it('applies at once, persists, and pushes mix changes to the engine', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.actions.initialize();
    h.actions.updateSettings({ audio: { backingVolume: 0.25, reverbEnabled: true } });
    expect(h.state().settings.audio).toMatchObject({ backingVolume: 0.25, reverbEnabled: true });
    expect(h.engine.mix).toMatchObject({ backingVolume: 0.25, reverbEnabled: true });
    await h.settle();
    expect(h.api.storedSettings.audio.backingVolume).toBe(0.25);
  });

  it('ends up with exactly what the main process stored', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.actions.initialize();
    const update = h.api.api.settings.update;
    h.api.api.settings.update = async (patch) => {
      const saved = await update(patch);
      return mergeSettings(saved, { audio: { monitorVolume: 0.42 } });
    };
    h.actions.updateSettings({ audio: { micGain: 1.5 } });
    h.actions.updateSettings({ audio: { micGain: 1.6 } });
    await h.settle();
    expect(h.state().settings.audio).toMatchObject({ micGain: 1.6, monitorVolume: 0.42 });
    expect(h.engine.mix.monitorVolume).toBe(0.42);
    // Both edits of the burst travelled together.
    expect(h.api.callsNamed('settings.update').at(-1)).toEqual([{ audio: { micGain: 1.6 } }]);
  });

  it('keeps going with a notice when settings cannot be saved', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.actions.initialize();
    h.api.failNextSettingsUpdate = new Error('disk full');
    h.actions.updateSettings({ audio: { backingVolume: 0.1 } });
    await h.settle();
    expect(h.state().settings.audio.backingVolume).toBe(0.1);
    expect(h.state().notices.at(-1)?.kind).toBe('warning');
  });

  it('clamps manual controls and nudges them by keyboard steps', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.actions.initialize();
    h.actions.setManualControl('echo', 1.7);
    expect(h.state().settings.controls.echo.manual).toBe(1);
    h.actions.nudgeManualControl('echo', -0.25);
    expect(h.state().settings.controls.echo.manual).toBeCloseTo(0.75, 9);
    h.actions.nudgeManualControl('autotune', -2);
    expect(h.state().settings.controls.autotune.manual).toBe(0);
    h.actions.setControlSource('volume', 'manual');
    expect(h.state().settings.controls.volume.source).toBe('manual');
  });

  it('switching to Audio Only stops the camera and hand tracking', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.openStudio();
    expect(h.state().tracking.status).toBe('running');
    await h.actions.setMode('audio');
    expect(h.state()).toMatchObject({
      settings: { mode: 'audio' },
      camera: { status: 'off' },
      tracking: { status: 'off' },
    });
    expect(h.mediaDevices.latestTrack.stopped).toBe(true);
    await h.actions.setMode('video');
    expect(h.state().camera.status).toBe('running');
  });
});

describe('control loop', () => {
  it('sends the manual values every frame when controls are manual', async () => {
    const h = createStudioHarness({
      ...IN_STUDIO,
      controls: {
        autotune: { source: 'manual', manual: 0.7 },
        echo: { source: 'manual', manual: 0.2 },
        volume: { source: 'manual', manual: 0.6 },
      },
    });
    await h.openStudio();
    await h.runFrames(2);
    expect(h.engine.controls).toEqual({ autotune: 0.7, echo: 0.2, volume: 0.6 });
    expect(h.live.controls).toEqual({ autotune: 0.7, echo: 0.2, volume: 0.6 });
    h.actions.setManualControl('echo', 0.9);
    await h.runFrames(1);
    expect(h.engine.controls?.echo).toBe(0.9);
  });

  it('copies meters, song position and latency into the live readouts', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.openStudio();
    h.engine.songPositionSec = 12.5;
    await h.runFrames(1);
    expect(h.live).toMatchObject({
      inputLevel: 0.4,
      outputLevel: 0.3,
      detectedMidi: 60.2,
      targetMidi: 60,
      songPositionSec: 12.5,
      recordingElapsedSec: 0,
    });
    h.engine.latency = { inputSec: 0.005, outputSec: 0.01, processingSec: 0.003 };
    await h.runFrames(40);
    expect(h.state().engine.monitoringLatencyMs).toBe(18);
  });

  it('follows the right hand for gesture controls while manual ones stay on their slider', async () => {
    const h = createStudioHarness({
      ...IN_STUDIO,
      controls: {
        autotune: { source: 'gesture', manual: 0.2 },
        volume: { source: 'manual', manual: 0.35 },
      },
    });
    await h.openStudio();
    await h.runFrames(30, 33, () => h.emitRightHand(0));
    expect(h.live.controlStatus.autotune).toBe('gesture');
    expect(h.live.controls.autotune).toBeGreaterThan(0.95);
    expect(h.live.controls.volume).toBe(0.35);
    expect(h.live.controlStatus.volume).toBe('manual');
    expect(h.engine.controls?.autotune).toBe(h.live.controls.autotune);
    expect(h.live.gesture?.right.status).toBe('tracking');

    await h.runFrames(30, 33, () => h.emitRightHand(1));
    expect(h.live.controls.autotune).toBeLessThan(0.05);
  });

  it('uses the sliders in Audio Only mode', async () => {
    const h = createStudioHarness({ ...IN_STUDIO, mode: 'audio' });
    await h.openStudio();
    await h.runFrames(10, 33, () => h.emitRightHand(0));
    expect(h.state().tracking.status).toBe('off');
    expect(h.live.controls).toEqual({ autotune: 0.5, echo: 0, volume: 0.5 });
    expect(h.live.gesture).toBeNull();
  });

  it('turns a tracker failure into one notice and manual control, with audio unaffected', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.openStudio();
    await h.runFrames(20, 33, () => h.emitRightHand(0));
    h.tracker.fail(createAppError('hand-tracking-failed', 'GPU lost'));
    h.tracker.fail(createAppError('hand-tracking-failed', 'GPU lost again'));
    await h.runFrames(80, 33, () => h.emitRightHand(0));
    expect(h.state().tracking).toMatchObject({
      status: 'error',
      error: { code: 'hand-tracking-failed' },
    });
    const trackingNotices = h.state().notices.filter((notice) => notice.message.includes('Hand'));
    expect(trackingNotices).toHaveLength(1);
    expect(h.live.controls.autotune).toBe(0.5);
    expect(h.live.controlStatus.autotune).toBe('manual');
    expect(h.state().engine.status).toBe('running');
    expect(h.tracker.started).toHaveLength(1);
  });

  it('stops tracking when hand control is switched off and resumes when it is back on', async () => {
    const h = createStudioHarness(IN_STUDIO);
    const preview = await h.openStudio();
    h.actions.updateSettings({ controls: { handControlEnabled: false } });
    expect(h.state().tracking.status).toBe('off');
    h.actions.updateSettings({ controls: { handControlEnabled: true } });
    await h.settle();
    expect(h.state().tracking.status).toBe('running');
    expect(h.tracker.started).toEqual([preview, preview]);
  });

  it('shows the camera in the attached preview and keeps it there across restarts', async () => {
    const h = createStudioHarness(IN_STUDIO);
    const preview = await h.openStudio();
    const first = preview.srcObject;
    expect(first).not.toBeNull();
    expect(preview.muted).toBe(true);
    expect(preview.playsInline).toBe(true);
    await h.actions.startCamera();
    expect(preview.srcObject).not.toBe(first);
    expect(preview.srcObject).not.toBeNull();
    h.actions.attachPreview(null);
    expect(preview.srcObject).toBeNull();
    expect(h.state().tracking.status).toBe('off');
  });

  it('calibrates the resting hand size from the right hand', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.openStudio();
    const calibrating = h.actions.calibrateHandDistance();
    await h.runFrames(Math.ceil(CALIBRATION_MS / 33) + 2, 33, () => h.emitRightHand(0, 0.26));
    await expect(calibrating).resolves.toBe(true);
    expect(h.state().settings.calibration.neutralHandScale).toBeGreaterThan(0.2);
    await h.runFrames(20, 33, () => h.emitRightHand(0, 0.26));
    expect(h.live.gesture?.right.proximity).toBeCloseTo(0.5, 1);

    const noHand = h.actions.calibrateHandDistance();
    await h.runFrames(Math.ceil(CALIBRATION_MS / 33) + 2);
    await expect(noHand).resolves.toBe(false);
  });
});

describe('songs', () => {
  it('loads a backing track into the engine and remembers it', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.actions.initialize();
    await h.actions.loadBackingTrack('/songs/backing.wav');
    expect(h.state().backing).toEqual({
      status: 'ready',
      file: { name: 'backing.wav', path: '/songs/backing.wav', durationSec: 30 },
      error: null,
    });
    expect(h.engine.hasBackingTrack).toBe(true);
    await h.settle();
    expect(h.api.storedSettings.lastSession.backingPath).toBe('/songs/backing.wav');

    h.actions.clearBackingTrack();
    expect(h.engine.backingTrack).toBeNull();
    expect(h.state().backing.status).toBe('none');
  });

  it('reports a file that cannot be read or decoded', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.actions.initialize();
    await h.actions.loadBackingTrack('/songs/missing.wav');
    expect(h.state().backing).toMatchObject({
      status: 'failed',
      error: { code: 'file-read-failed' },
    });
    h.engine.decodeResult = fail('unsupported-audio-file', 'not audio');
    await h.actions.loadBackingTrack('/songs/backing.wav');
    expect(h.state().backing.error?.code).toBe('unsupported-audio-file');
    expect(h.state().notices.at(-1)?.kind).toBe('error');
  });

  it('analyses an uncached reference with progress, caches it and sets the pitch targets', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.actions.initialize();
    const loading = h.actions.loadReferenceSong('/songs/reference.mp3');
    await h.settle();
    expect(h.state().reference).toMatchObject({ status: 'analyzing', progress: 0 });
    h.analysis.analyses[0]?.onProgress?.(0.4);
    expect(h.state().reference.progress).toBe(0.4);
    h.analysis.analyses[0]?.result.resolve(referenceAnalysis());
    await loading;
    await h.settle();
    expect(h.state().reference).toMatchObject({
      status: 'ready',
      keyLabel: 'A minor',
      melodyUsable: true,
      progress: 1,
      file: { name: 'reference.mp3', durationSec: 40 },
    });
    expect(h.api.analysisCache.has('sha-ref')).toBe(true);
    // No backing track: no song clock, so key only.
    expect(h.engine.pitchTargets?.notes).toHaveLength(0);
    expect(h.engine.pitchTargets?.key).toMatchObject({ tonic: 9, mode: 'minor' });
  });

  it('serves a cached analysis without analysing again', async () => {
    const h = createStudioHarness(IN_STUDIO);
    h.api.analysisCache.set('sha-ref', referenceAnalysis({ quality: 'poor' }));
    await h.actions.initialize();
    const statuses: string[] = [];
    h.studio.store.subscribe((state) => statuses.push(state.reference.status));
    await h.actions.loadReferenceSong('/songs/reference.mp3');
    expect(h.analysis.analyses).toHaveLength(0);
    expect(statuses).not.toContain('analyzing');
    expect(h.state().reference).toMatchObject({ status: 'ready', melodyUsable: false });
  });

  it('keeps autotune on the nearest note when the analysis fails', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.actions.initialize();
    const loading = h.actions.loadReferenceSong('/songs/reference.mp3');
    await h.settle();
    h.analysis.analyses[0]?.result.reject(new Error('worker crashed'));
    await loading;
    await h.settle();
    expect(h.state().reference).toMatchObject({
      status: 'failed',
      error: { code: 'analysis-failed' },
    });
    expect(h.engine.pitchTargets).toBeNull();
    expect(h.state().notices.at(-1)?.kind).toBe('error');
  });

  it('aligns the melody to the backing track and re-aligns when the backing changes', async () => {
    const h = createStudioHarness(IN_STUDIO);
    h.api.analysisCache.set('sha-ref', referenceAnalysis());
    await h.actions.initialize();
    await h.actions.loadBackingTrack('/songs/backing.wav');
    await h.actions.loadReferenceSong('/songs/reference.mp3');
    await h.settle();
    expect(h.analysis.alignments).toHaveLength(1);
    h.analysis.alignments[0]?.result.resolve({ offsetSec: 0.5, confidence: 0.9 });
    await h.settle();
    // Song time = reference time - 0.5 s.
    expect(Array.from(h.engine.pitchTargets?.notes ?? [])).toEqual([0.5, 1.5, 69, 1.5, 2.5, 72]);

    await h.actions.loadBackingTrack('/songs/other.wav');
    await h.settle();
    expect(h.analysis.alignments).toHaveLength(2);
    expect(h.analysis.alignments[1]?.backing.left.length).toBe(20 * 48000);
    h.analysis.alignments[1]?.result.resolve({ offsetSec: -1, confidence: 0.9 });
    await h.settle();
    expect(Array.from(h.engine.pitchTargets?.notes ?? [])).toEqual([2, 3, 69, 3, 4, 72]);

    h.actions.clearReferenceSong();
    await h.settle();
    expect(h.engine.pitchTargets).toBeNull();
  });

  it('lets the latest request win when loads overlap', async () => {
    const h = createStudioHarness(IN_STUDIO);
    h.api.analysisCache.set(
      'sha-ref',
      referenceAnalysis({ key: { tonic: 0, mode: 'major', confidence: 0.9 } }),
    );
    h.api.analysisCache.set('sha-ref2', referenceAnalysis());
    let openGate: () => void = () => undefined;
    h.api.readGates.set(
      '/songs/reference.mp3',
      new Promise((resolve) => {
        openGate = resolve;
      }),
    );
    await h.actions.initialize();
    const older = h.actions.loadReferenceSong('/songs/reference.mp3');
    const newer = h.actions.loadReferenceSong('/songs/reference2.mp3');
    await newer;
    openGate();
    await older;
    await h.settle();
    expect(h.state().reference).toMatchObject({
      status: 'ready',
      keyLabel: 'A minor',
      file: { path: '/songs/reference2.mp3' },
    });
    expect(h.engine.pitchTargets?.key?.tonic).toBe(9);
  });

  it('auditions the backing track outside a recording and stops it when a take starts', async () => {
    const h = createStudioHarness({
      ...IN_STUDIO,
      mode: 'audio',
      recording: { countdownEnabled: false },
    });
    await h.actions.initialize();
    h.actions.togglePreviewPlayback();
    expect(h.state().previewPlaying).toBe(false);

    await h.actions.loadBackingTrack('/songs/backing.wav');
    h.actions.togglePreviewPlayback();
    expect(h.state().previewPlaying).toBe(true);
    expect(h.engine.callsNamed('startBacking')).toEqual([[{ offsetSec: 0 }]]);
    h.engine.endBacking();
    expect(h.state().previewPlaying).toBe(false);

    h.actions.togglePreviewPlayback();
    await h.actions.startRecording();
    expect(h.state().previewPlaying).toBe(false);
    expect(h.state().recording.status).toBe('recording');
  });
});

describe('recording through the studio', () => {
  it('finishes the take when the microphone is lost mid-take', async () => {
    const h = createStudioHarness({ ...IN_STUDIO, recording: { countdownEnabled: false } });
    await h.openStudio();
    await h.actions.startRecording();
    for (let second = 0; second < 2; second++) {
      h.engine.emitChunk(48000);
      await h.clock.advance(1000);
    }
    h.engine.fail(createAppError('device-disconnected', 'mic unplugged'));
    for (let step = 0; step < 20; step++) await h.clock.advance(100);
    expect(h.state().recording.status).toBe('review');
    expect(h.state().engine.status).toBe('error');
    expect(h.state().notices.at(-1)?.message).toContain('your take was kept');
  });

  it('finishes the take when the camera is unplugged mid-take', async () => {
    const h = createStudioHarness({ ...IN_STUDIO, recording: { countdownEnabled: false } });
    await h.openStudio();
    await h.actions.startRecording();
    h.engine.emitChunk(48000);
    await h.clock.advance(1000);
    h.mediaDevices.latestTrack.end();
    for (let step = 0; step < 20; step++) await h.clock.advance(100);
    expect(h.state().camera).toMatchObject({
      status: 'error',
      error: { code: 'device-disconnected' },
    });
    expect(h.state().recording.status).toBe('review');
  });

  it('starts and stops a take with the both-fists gesture only when extra gestures are on', async () => {
    const h = createStudioHarness({ ...IN_STUDIO, recording: { countdownEnabled: false } });
    await h.openStudio();
    const bothFists = (): void =>
      h.tracker.emitFrame(
        syntheticFrame(h.clock.nowMs(), [
          syntheticHand({ side: 'right', closure: 1, centre: { x: 0.3, y: 0.5 } }),
          syntheticHand({ side: 'left', closure: 1, centre: { x: 0.7, y: 0.5 } }),
        ]),
      );
    await h.runFrames(80, 33, bothFists);
    expect(h.state().recording.status).toBe('idle');

    h.actions.updateSettings({ controls: { extraGesturesEnabled: true } });
    await h.runFrames(80, 33, bothFists);
    await h.settle();
    expect(h.state().recording.status).toBe('recording');
  });
});

describe('notices', () => {
  it('does not repeat an identical message and can be dismissed', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.actions.initialize();
    await h.actions.loadBackingTrack('/songs/missing.wav');
    await h.actions.loadBackingTrack('/songs/missing.wav');
    const { notices } = h.state();
    expect(notices).toHaveLength(1);
    h.actions.dismissNotice(notices[0]?.id ?? '');
    expect(h.state().notices).toEqual([]);
  });
});

describe('dispose', () => {
  it('releases devices, listeners and timers', async () => {
    const h = createStudioHarness(IN_STUDIO);
    await h.openStudio();
    await h.studio.dispose();
    expect(h.mediaDevices.listenerCount).toBe(0);
    expect(h.engine.isRunning).toBe(false);
    expect(h.mediaDevices.latestTrack.stopped).toBe(true);
    expect(h.analysis.disposed).toBe(true);
    expect(h.clock.pendingFrameCount).toBe(0);
    expect(h.clock.pendingTimerCount).toBe(0);
    expect(h.engine.listenerCounts).toEqual({ stems: 0, backingEnded: 0, errors: 0 });
  });
});
