// A Studio with fixed state and recording no-op actions. Screens can be rendered, reviewed
// and tested against it without a microphone, a camera, or the main process.
import { createStore } from 'zustand/vanilla';
import type { ControlId, ControlSource } from '@shared/controls';
import { DEFAULT_SETTINGS, type DeepPartial, type Settings } from '@shared/settings';
import type { LiveReadouts, Studio, StudioActions, StudioState } from './studioTypes';

export function createInitialStudioState(): StudioState {
  return {
    phase: 'loading',
    appInfo: null,
    settings: structuredClone(DEFAULT_SETTINGS),
    devices: { microphones: [], cameras: [], outputs: [], outputSelectionSupported: true },
    permissions: { microphone: 'not-determined', camera: 'not-determined' },
    engine: { status: 'off', error: null, monitoringLatencyMs: null },
    camera: { status: 'off', error: null, width: 0, height: 0 },
    tracking: { status: 'off', error: null },
    backing: { status: 'none', file: null, error: null },
    reference: {
      status: 'none',
      file: null,
      progress: 0,
      keyLabel: null,
      melodyUsable: false,
      error: null,
    },
    previewPlaying: false,
    recording: {
      status: 'idle',
      countdownRemaining: 0,
      takeDurationSec: 0,
      exportStage: null,
      exportProgress: 0,
      savedPath: null,
      error: null,
    },
    notices: [],
  };
}

export function createInitialLiveReadouts(): LiveReadouts {
  return {
    controls: { autotune: 0, echo: 0, volume: 0.5 },
    controlStatus: { autotune: 'manual', echo: 'manual', volume: 'manual' },
    gesture: null,
    inputLevel: 0,
    outputLevel: 0,
    detectedMidi: null,
    targetMidi: null,
    recordingElapsedSec: 0,
    songPositionSec: null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively overlays `patch` on `base`; arrays and primitives are replaced whole. */
export function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    merged[key] = deepMerge(merged[key], value as DeepPartial<unknown>);
  }
  return merged as T;
}

/** The settings change a preview should show for an action, if any. */
function settingsPatchFor(
  name: keyof StudioActions,
  args: unknown[],
): DeepPartial<Settings> | null {
  switch (name) {
    case 'updateSettings':
      return args[0] as DeepPartial<Settings>;
    case 'setMode':
      return { mode: args[0] as Settings['mode'] };
    case 'setControlSource':
      return { controls: { [args[0] as ControlId]: { source: args[1] as ControlSource } } };
    case 'setManualControl':
      return { controls: { [args[0] as ControlId]: { manual: args[1] as number } } };
    default:
      return null;
  }
}

export interface ActionCall {
  name: keyof StudioActions;
  args: unknown[];
}

export interface StaticStudio extends Studio {
  /** Every action invoked so far, in order. */
  calls: ActionCall[];
}

/**
 * @param stateOverrides overlaid on the initial state
 * @param liveOverrides overlaid on the initial live readouts
 */
export function createStaticStudio(
  stateOverrides: DeepPartial<StudioState> = {},
  liveOverrides: Partial<LiveReadouts> = {},
): StaticStudio {
  const store = createStore<StudioState>(() =>
    deepMerge(createInitialStudioState(), stateOverrides),
  );
  const live: LiveReadouts = { ...createInitialLiveReadouts(), ...liveOverrides };
  const calls: ActionCall[] = [];

  // Every action records its call and resolves; edits to settings are applied so that the
  // controls bound to them (sliders, toggles, mode switch) respond in previews.
  const actions = new Proxy({} as StudioActions, {
    get(_target, property) {
      const name = property as keyof StudioActions;
      return (...args: unknown[]) => {
        calls.push({ name, args });
        const patch = settingsPatchFor(name, args);
        if (patch) store.setState((state) => ({ settings: deepMerge(state.settings, patch) }));
        return Promise.resolve(undefined);
      };
    },
  });

  return { store, actions, live, calls };
}
