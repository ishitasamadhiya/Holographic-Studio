// The real Studio: one store, the live readouts, and the actions the screens call. It wires
// the audio engine, camera, hand tracking, songs and recording together; each of those lives
// in its own module and this file only decides when they run and what the user is told.
import { createStore } from 'zustand/vanilla';
import { deriveNeutralHandScale, type ExtraGestureEvent, type GestureFrame } from '@gestures/index';
import { CameraController } from '@renderer/camera/cameraController';
import { sleep } from '@renderer/recording/clock';
import { RecordingController } from '@renderer/recording/recordingController';
import { computeMonitoringLatencySec } from '@renderer/recording/syncTimeline';
import { createInitialLiveReadouts, createInitialStudioState } from '@renderer/state/staticStudio';
import type {
  Notice,
  RecordingState,
  Studio,
  StudioActions,
  StudioState,
} from '@renderer/state/studioTypes';
import { clamp01, type ControlId, type ControlSource } from '@shared/controls';
import { createAppError, type AppError } from '@shared/errors';
import type { MediaKind, PermissionStatus } from '@shared/ipc';
import { mergeSettings } from '@shared/settingsSchema';
import type { DeepPartial, RecordingMode, Settings } from '@shared/settings';
import { catalogDevices, isSelectionMissing, type DeviceGroup } from './deviceCatalog';
import { HandTracking } from './handTracking';
import { LiveLoop } from './liveLoop';
import { withNotice, withoutNotice } from './notices';
import { SettingsSync } from './settingsSync';
import { SongLibrary } from './songLibrary';
import { resolveStudioDependencies, type StudioDependencies } from './studioDependencies';

export type { StudioDependencies } from './studioDependencies';

/** How long calibrateHandDistance watches the right hand. */
export const CALIBRATION_MS = 1500;

export const TAKE_IN_PROGRESS_MESSAGE = 'Finish or discard the current take first.';

const DEVICE_FALLBACK_MESSAGES: Record<DeviceGroup, string> = {
  microphones: 'Your selected microphone is no longer connected. Using the system default.',
  cameras: 'Your selected camera is no longer connected. Using the default camera.',
  outputs: 'Your selected headphones are no longer connected. Using the system default output.',
};

const DEVICE_SETTING: Record<DeviceGroup, keyof Settings['devices']> = {
  microphones: 'microphoneId',
  cameras: 'cameraId',
  outputs: 'outputId',
};

export interface StudioHandle extends Studio {
  /** Stops every device, worker, timer and listener. The app itself never needs it. */
  dispose(): Promise<void>;
}

function isBlocked(status: PermissionStatus): boolean {
  return status === 'denied' || status === 'restricted';
}

/** Monitoring latency is shown to a tenth of a millisecond; finer changes are noise. */
function roundLatencyMs(latencyMs: number): number {
  return Math.round(latencyMs * 10) / 10;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createStudio(dependencies: Partial<StudioDependencies> = {}): StudioHandle {
  const deps = resolveStudioDependencies(dependencies);
  const { api, clock, mediaDevices } = deps;
  const store = createStore<StudioState>(createInitialStudioState);
  const live = createInitialLiveReadouts();
  const engine = deps.createAudioEngine();
  const get = store.getState;
  const set = (patch: Partial<StudioState>): void => store.setState(patch);

  let noticeCount = 0;
  const notify = (kind: Notice['kind'], message: string): void => {
    noticeCount += 1;
    const notice: Notice = { id: `notice-${noticeCount}`, kind, message };
    store.setState((state) => ({ notices: withNotice(state.notices, notice) }));
  };

  // ---------------------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------------------

  const settingsSync = new SettingsSync({
    save: (patch) => api.settings.update(patch),
    getSettings: () => get().settings,
    applySettings: (next, previous) => {
      set({ settings: next });
      applySideEffects(next, previous);
    },
    onSaveFailed: () => {
      notify('warning', 'Your settings could not be saved. They still apply until you quit.');
    },
  });

  /** Settings changes made by the app itself (never refused). */
  const saveSettings = (patch: DeepPartial<Settings>): void => settingsSync.update(patch);

  /** Removes device and mode changes from a patch while a take is being recorded. */
  function withoutTakeSensitiveChanges(patch: DeepPartial<Settings>): DeepPartial<Settings> {
    if (!recording.isTakeInProgress) return patch;
    const { mode, devices, video, ...rest } = patch;
    const current = get().settings;
    const sensitive = mergeSettings(current, { mode, devices, video });
    const changes = !sameJson(
      [sensitive.mode, sensitive.devices, sensitive.video],
      [current.mode, current.devices, current.video],
    );
    if (changes) notify('warning', TAKE_IN_PROGRESS_MESSAGE);
    return rest;
  }

  function applySideEffects(next: Settings, previous: Settings): void {
    if (!sameJson(next.audio, previous.audio)) engine.setMix({ ...next.audio });
    if (next.calibration.neutralHandScale !== previous.calibration.neutralHandScale) {
      tracking.setNeutralHandScale(next.calibration.neutralHandScale);
    }
    tracking.setExtraGesturesEnabled(next.controls.extraGesturesEnabled);
    if (next.mode !== previous.mode) queueDeviceWork(() => applyMode(next.mode));
    if (
      !sameJson(next.devices, previous.devices) ||
      next.video.resolution !== previous.video.resolution
    ) {
      queueDeviceWork(applyDeviceSelection);
    }
    syncTracking();
  }

  // ---------------------------------------------------------------------------------------
  // Permissions and devices
  // ---------------------------------------------------------------------------------------

  const setPermission = (kind: MediaKind, status: PermissionStatus): void => {
    store.setState((state) => ({ permissions: { ...state.permissions, [kind]: status } }));
  };

  /** Asks the system for access when it has not been decided yet. */
  async function ensureAccess(kind: MediaKind): Promise<PermissionStatus> {
    let status: PermissionStatus;
    try {
      status = await api.permissions.getStatus(kind);
      if (status === 'not-determined') status = await api.permissions.request(kind);
    } catch {
      status = 'unknown';
    }
    setPermission(kind, status);
    return status;
  }

  async function refreshPermissions(): Promise<void> {
    await Promise.all(
      (['microphone', 'camera'] as const).map(async (kind) => {
        const status = await api.permissions
          .getStatus(kind)
          .catch((): PermissionStatus => 'unknown');
        setPermission(kind, status);
      }),
    );
  }

  let deviceRefresh = 0;
  /** Set when a device check had to wait for the take in progress to end. */
  let devicesNeedReview = false;

  async function refreshDevices(): Promise<void> {
    const request = ++deviceRefresh;
    const infos = await mediaDevices.enumerateDevices().catch(() => null);
    if (infos === null || request !== deviceRefresh) return;
    const catalog = catalogDevices(infos);
    set({
      devices: {
        microphones: catalog.microphones,
        cameras: catalog.cameras,
        outputs: catalog.outputs,
        outputSelectionSupported: engine.outputSelectionSupported,
      },
    });
    if (recording.isTakeInProgress) {
      devicesNeedReview = true;
      return;
    }
    devicesNeedReview = false;
    const selected = get().settings.devices;
    const fallback: Partial<Settings['devices']> = {};
    for (const group of ['microphones', 'cameras', 'outputs'] as const) {
      const setting = DEVICE_SETTING[group];
      if (!isSelectionMissing(selected[setting], catalog, group)) continue;
      fallback[setting] = null;
      notify('warning', DEVICE_FALLBACK_MESSAGES[group]);
    }
    if (Object.keys(fallback).length > 0) saveSettings({ devices: fallback });
  }

  const onDeviceChange = (): void => {
    void refreshDevices();
  };

  /** Device switches run one at a time, in the order they were asked for. */
  let deviceWork: Promise<void> = Promise.resolve();
  function queueDeviceWork(work: () => Promise<void> | void): Promise<void> {
    deviceWork = deviceWork.then(work).catch((error: unknown) => {
      console.warn('Device switch failed', error);
    });
    return deviceWork;
  }

  /** The devices the running engine was opened with. */
  let engineDevices: { microphoneId: string | null; outputId: string | null } | null = null;
  /** What the running camera was opened with. */
  let cameraOpenedWith: {
    deviceId: string | null;
    resolution: Settings['video']['resolution'];
  } | null = null;

  async function applyDeviceSelection(): Promise<void> {
    const { devices, video } = get().settings;
    if (engine.isRunning && engineDevices) {
      if (devices.microphoneId !== engineDevices.microphoneId) {
        engineDevices.microphoneId = devices.microphoneId;
        reportEngineResult(await engine.setMicrophone(devices.microphoneId));
      }
      if (devices.outputId !== engineDevices.outputId) {
        engineDevices.outputId = devices.outputId;
        reportEngineResult(await engine.setOutput(devices.outputId));
      }
    }
    const cameraActive = camera.running !== null || get().camera.status === 'starting';
    if (
      cameraActive &&
      cameraOpenedWith &&
      (cameraOpenedWith.deviceId !== devices.cameraId ||
        cameraOpenedWith.resolution !== video.resolution)
    ) {
      await openCamera();
    }
  }

  async function applyMode(mode: RecordingMode): Promise<void> {
    if (mode === 'audio') {
      closeCamera();
    } else if (get().phase === 'studio') {
      await openCamera();
    }
  }

  // ---------------------------------------------------------------------------------------
  // Audio engine
  // ---------------------------------------------------------------------------------------

  function setEngineState(patch: Partial<StudioState['engine']>): void {
    store.setState((state) => ({ engine: { ...state.engine, ...patch } }));
  }

  function reportEngineResult(result: { ok: true } | { ok: false; error: AppError }): void {
    if (result.ok) return;
    if (!engine.isRunning) setEngineState({ status: 'error', error: result.error });
    notify('error', result.error.message);
  }

  let audioStart: Promise<void> | null = null;

  function startAudio(): Promise<void> {
    if (engine.isRunning) return Promise.resolve();
    audioStart ??= openAudio().finally(() => {
      audioStart = null;
    });
    return audioStart;
  }

  async function openAudio(): Promise<void> {
    setEngineState({ status: 'starting', error: null });
    if (isBlocked(await ensureAccess('microphone'))) {
      const error = createAppError('microphone-permission-denied');
      setEngineState({ status: 'error', error, monitoringLatencyMs: null });
      notify('error', error.message);
      return;
    }

    const { microphoneId, outputId } = get().settings.devices;
    let opened = { microphoneId, outputId };
    let result = await engine.start(opened).catch((cause: unknown) => ({
      ok: false as const,
      error: createAppError('audio-engine-failed', cause),
    }));
    if (
      !result.ok &&
      microphoneId !== null &&
      result.error.code !== 'microphone-permission-denied'
    ) {
      // The chosen microphone may be gone; the default one is better than no audio at all.
      opened = { microphoneId: null, outputId };
      const retry = await engine.start(opened).catch(() => result);
      if (retry.ok) {
        result = retry;
        notify('warning', DEVICE_FALLBACK_MESSAGES.microphones);
        saveSettings({ devices: { microphoneId: null } });
      }
    }
    if (!result.ok) {
      setEngineState({ status: 'error', error: result.error, monitoringLatencyMs: null });
      notify('error', result.error.message);
      return;
    }

    engineDevices = opened;
    engine.setMix({ ...get().settings.audio });
    songs.restoreEngine();
    setEngineState({
      status: 'running',
      error: null,
      monitoringLatencyMs: roundLatencyMs(computeMonitoringLatencySec(engine.getLatency()) * 1000),
    });
    void refreshDevices();
  }

  // ---------------------------------------------------------------------------------------
  // Camera and hand tracking
  // ---------------------------------------------------------------------------------------

  const camera = new CameraController({
    mediaDevices,
    onState: (state) => {
      set({ camera: state });
      syncTracking();
    },
    onLost: (error) => {
      cameraOpenedWith = null;
      if (recording.isTakeInProgress && get().settings.mode === 'video') {
        notify('warning', `${error.message} Recording stopped; your take was kept.`);
        void recording.finishAfterDeviceLoss();
      } else {
        notify('warning', error.message);
      }
    },
    onPreviewChanged: () => syncTracking(),
  });

  let cameraStart: Promise<void> | null = null;

  /** Opens (or reopens) the camera with the selected device and resolution. */
  function openCamera(): Promise<void> {
    const run = async (): Promise<void> => {
      if (isBlocked(await ensureAccess('camera'))) {
        const error = createAppError('camera-permission-denied');
        set({ camera: { status: 'error', error, width: 0, height: 0 } });
        notify('error', error.message);
        return;
      }
      const { devices, video } = get().settings;
      const result = await camera.start({
        deviceId: devices.cameraId,
        resolution: video.resolution,
      });
      if (!result.ok) {
        cameraOpenedWith = null;
        notify('error', result.error.message);
        return;
      }
      cameraOpenedWith = {
        deviceId: result.value.usedDefaultDevice ? null : devices.cameraId,
        resolution: video.resolution,
      };
      if (result.value.usedDefaultDevice) {
        notify('warning', DEVICE_FALLBACK_MESSAGES.cameras);
        saveSettings({ devices: { cameraId: null } });
      }
      void refreshDevices();
    };
    const previous = cameraStart ?? Promise.resolve();
    const current = previous.then(run).catch((cause: unknown) => {
      notify('error', createAppError('unknown', cause).message);
    });
    cameraStart = current;
    return current.finally(() => {
      if (cameraStart === current) cameraStart = null;
    });
  }

  function closeCamera(): void {
    cameraOpenedWith = null;
    camera.stop();
  }

  const tracking = new HandTracking({
    createTracker: deps.createHandTracker,
    onState: (state) => set({ tracking: state }),
    onFailure: (error) => notify('warning', error.message),
    onExtraGesture: (event) => handleExtraGesture(event),
  });

  /** Tracking runs in video mode, with the camera on, a preview to read and hand control on. */
  function syncTracking(): void {
    const { settings, camera: cameraState } = get();
    const wanted =
      settings.mode === 'video' &&
      cameraState.status === 'running' &&
      settings.controls.handControlEnabled;
    tracking.sync(wanted ? camera.preview : null);
  }

  function handleExtraGesture(event: ExtraGestureEvent): void {
    const { settings, recording: recordingState } = get();
    if (!settings.controls.extraGesturesEnabled) return;
    if (event === 'toggle-reverb') {
      const enabled = !settings.audio.reverbEnabled;
      saveSettings({ audio: { reverbEnabled: enabled } });
      notify('info', enabled ? 'Reverb on' : 'Reverb off');
    } else if (recordingState.status === 'idle') {
      void recording.start();
    } else if (recordingState.status === 'recording' || recordingState.status === 'paused') {
      void recording.stop();
    }
  }

  async function calibrateHandDistance(): Promise<boolean> {
    const frames: GestureFrame[] = [];
    const stopListening = tracking.onGesture((frame) => frames.push(frame));
    try {
      await sleep(clock, CALIBRATION_MS);
    } finally {
      stopListening();
    }
    const scale = deriveNeutralHandScale(frames, 'right');
    if (scale === null) return false;
    saveSettings({ calibration: { neutralHandScale: scale } });
    return true;
  }

  // ---------------------------------------------------------------------------------------
  // Songs and preview playback
  // ---------------------------------------------------------------------------------------

  const songs = new SongLibrary({
    api,
    engine,
    analysis: deps.createAnalysisClient(),
    setBacking: (backing) => set({ backing }),
    setReference: (reference) => set({ reference }),
    rememberSession: (lastSession) => saveSettings({ lastSession }),
    notify,
  });

  function stopPreview(): void {
    if (!get().previewPlaying) return;
    if (engine.isBackingPlaying) engine.stopBacking();
    set({ previewPlaying: false });
  }

  function togglePreviewPlayback(): void {
    if (get().previewPlaying) {
      stopPreview();
      return;
    }
    if (recording.isTakeInProgress || !engine.isRunning || !engine.hasBackingTrack) return;
    engine.startBacking({ offsetSec: 0 });
    set({ previewPlaying: true });
  }

  /** Refuses (with a notice) while a take is being recorded. */
  function refuseDuringTake(): boolean {
    if (!recording.isTakeInProgress) return false;
    notify('warning', TAKE_IN_PROGRESS_MESSAGE);
    return true;
  }

  async function restoreLastSession(): Promise<void> {
    const { backingPath, referencePath } = get().settings.lastSession;
    await Promise.all([
      backingPath ? songs.loadBacking(backingPath, { silent: true }) : null,
      referencePath ? songs.loadReference(referencePath, { silent: true }) : null,
    ]);
  }

  // ---------------------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------------------

  function setRecording(patch: Partial<RecordingState>): void {
    store.setState((state) => ({ recording: { ...state.recording, ...patch } }));
    // Device checks put off during the take run once it is over (after the start settles).
    if (devicesNeedReview && (patch.status === 'idle' || patch.status === 'review')) {
      clock.setTimeout(onDeviceChange, 0);
    }
  }

  const recording = new RecordingController({
    api,
    engine,
    clock,
    videoRecorders: deps.videoRecorders,
    renderTakeArtwork: deps.renderTakeArtwork,
    now: deps.now,
    getSettings: () => get().settings,
    getCameraFeed: () => camera.running,
    getCameraError: () => get().camera.error,
    getBackingTrackName: () => get().backing.file?.name ?? null,
    getState: () => get().recording,
    setState: setRecording,
    notify,
    onTakeStarting: stopPreview,
  });

  // ---------------------------------------------------------------------------------------
  // Engine events and the live loop
  // ---------------------------------------------------------------------------------------

  const unsubscribeEngineErrors = engine.onError((error) => {
    setEngineState({ status: engine.isRunning ? 'running' : 'error', error });
    if (recording.isTakeInProgress) {
      notify('error', `${error.message} Recording stopped; your take was kept.`);
      void recording.finishAfterDeviceLoss();
    } else {
      notify('error', error.message);
    }
  });

  const unsubscribeBackingEnded = engine.onBackingEnded(() => {
    if (get().previewPlaying) set({ previewPlaying: false });
  });

  const liveLoop = new LiveLoop({
    clock,
    live,
    getState: get,
    getEngine: () => engine,
    getGesture: () => tracking.latest,
    getRecordingElapsedSec: (nowMs) => recording.elapsedSec(nowMs),
    onMonitoringLatency: (latencyMs) => {
      const rounded = roundLatencyMs(latencyMs);
      const { engine: engineState } = get();
      if (engineState.status === 'running' && engineState.monitoringLatencyMs !== rounded) {
        setEngineState({ monitoringLatencyMs: rounded });
      }
    },
  });

  // ---------------------------------------------------------------------------------------
  // Phases
  // ---------------------------------------------------------------------------------------

  async function enterStudio(): Promise<void> {
    await startAudio();
    // The wizard may have opened the camera already.
    const { settings, camera: cameraState } = get();
    if (settings.mode === 'video' && cameraState.status !== 'running') await openCamera();
  }

  let initialization: Promise<void> | null = null;

  async function initialize(): Promise<void> {
    try {
      const [appInfo, settings] = await Promise.all([api.app.getInfo(), api.settings.load()]);
      set({ appInfo, settings });
    } catch (error) {
      notify('error', createAppError('unknown', error).message);
    }
    const { settings } = get();
    engine.setMix({ ...settings.audio });
    tracking.setNeutralHandScale(settings.calibration.neutralHandScale);
    tracking.setExtraGesturesEnabled(settings.controls.extraGesturesEnabled);
    mediaDevices.addEventListener('devicechange', onDeviceChange);
    await Promise.all([refreshPermissions(), refreshDevices()]);
    liveLoop.start();

    if (settings.onboardingComplete) {
      set({ phase: 'studio' });
      await enterStudio();
    } else {
      set({ phase: 'wizard' });
    }
    void restoreLastSession();
  }

  // ---------------------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------------------

  function updateControl(
    control: ControlId,
    patch: { source?: ControlSource; manual?: number },
  ): void {
    const controls: DeepPartial<Settings['controls']> = {};
    controls[control] = patch;
    saveSettings({ controls });
  }

  async function selectDevice(
    setting: keyof Settings['devices'],
    deviceId: string | null,
  ): Promise<void> {
    if (refuseDuringTake()) return;
    const devices: Partial<Settings['devices']> = {};
    devices[setting] = deviceId;
    saveSettings({ devices });
    await deviceWork;
  }

  const actions: StudioActions = {
    initialize: () => {
      initialization ??= initialize();
      return initialization;
    },
    updateSettings: (patch) => saveSettings(withoutTakeSensitiveChanges(patch)),

    requestPermission: async (kind) => {
      const status = await api.permissions.request(kind).catch((): PermissionStatus => 'unknown');
      setPermission(kind, status);
      if (status === 'granted') await refreshDevices();
      return status;
    },
    openPermissionSettings: (kind) => {
      void api.permissions.openSystemSettings(kind).catch(() => undefined);
    },
    refreshDevices,
    selectMicrophone: (deviceId) => selectDevice('microphoneId', deviceId),
    selectCamera: (deviceId) => selectDevice('cameraId', deviceId),
    selectOutput: (deviceId) => selectDevice('outputId', deviceId),
    setMode: async (mode) => {
      if (mode === get().settings.mode || refuseDuringTake()) return;
      saveSettings({ mode });
      await deviceWork;
    },

    startAudio,
    startCamera: () => openCamera(),
    stopCamera: () => {
      if (get().settings.mode === 'video' && refuseDuringTake()) return;
      closeCamera();
    },
    attachPreview: (element) => camera.attachPreview(element),
    playTestSound: async () => {
      if (!engine.isRunning) return;
      await engine.playTestSound().catch(() => undefined);
    },
    calibrateHandDistance,

    setControlSource: (control, source) => updateControl(control, { source }),
    setManualControl: (control, value) => updateControl(control, { manual: clamp01(value) }),
    nudgeManualControl: (control, delta) => {
      const current = get().settings.controls[control].manual;
      updateControl(control, { manual: clamp01(current + delta) });
    },

    chooseBackingTrack: async () => {
      if (refuseDuringTake()) return;
      const picked = await api.files.pickAudioFile('backing').catch(() => null);
      if (picked) await actions.loadBackingTrack(picked.path);
    },
    loadBackingTrack: async (path) => {
      if (refuseDuringTake()) return;
      stopPreview();
      await songs.loadBacking(path);
    },
    clearBackingTrack: () => {
      if (refuseDuringTake()) return;
      stopPreview();
      songs.clearBacking();
    },
    chooseReferenceSong: async () => {
      const picked = await api.files.pickAudioFile('reference').catch(() => null);
      if (picked) await actions.loadReferenceSong(picked.path);
    },
    loadReferenceSong: (path) => songs.loadReference(path),
    clearReferenceSong: () => songs.clearReference(),
    togglePreviewPlayback,

    completeOnboarding: () => {
      saveSettings({ onboardingComplete: true });
      set({ phase: 'studio' });
      void enterStudio();
    },
    restartOnboarding: () => {
      if (refuseDuringTake()) return;
      saveSettings({ onboardingComplete: false });
      set({ phase: 'wizard' });
    },

    startRecording: () => recording.start(),
    togglePause: () => recording.togglePause(),
    stopRecording: () => recording.stop(),
    discardTake: () => recording.discard(),
    saveTake: () => recording.save(),
    cancelExport: () => recording.cancelExport(),
    openSavedFile: () => recording.openSavedFile(),
    showSavedInFolder: () => recording.showSavedInFolder(),
    recordAnother: () => recording.recordAnother(),

    dismissNotice: (id) => {
      store.setState((state) => ({ notices: withoutNotice(state.notices, id) }));
    },
  };

  async function dispose(): Promise<void> {
    mediaDevices.removeEventListener('devicechange', onDeviceChange);
    liveLoop.stop();
    unsubscribeEngineErrors();
    unsubscribeBackingEnded();
    tracking.dispose();
    await recording.dispose();
    closeCamera();
    camera.attachPreview(null);
    songs.dispose();
    await engine.stop().catch(() => undefined);
  }

  return { store, actions, live, dispose };
}
