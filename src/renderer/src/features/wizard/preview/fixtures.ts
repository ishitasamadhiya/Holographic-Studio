// Fixed app states for reviewing and testing the wizard one step at a time, without a
// microphone, a camera or the main process. Used only by the developer preview page.
import type { GestureFrame, HandState, HandStatus } from '@gestures/index';
import type { HandSide } from '@shared/controls';
import { createAppError } from '@shared/errors';
import type { DeepPartial } from '@shared/settings';
import { deepMerge } from '@renderer/state/staticStudio';
import type { LiveReadouts, SongFile, StudioState } from '@renderer/state/studioTypes';
import { isWizardStepId, WIZARD_STEP_IDS, type WizardStepId } from '../logic/wizardSteps';

export interface WizardPreviewFixture {
  step: WizardStepId;
  variant: string;
  state: DeepPartial<StudioState>;
  live: Partial<LiveReadouts>;
  /** What "Set my resting distance" reports back. */
  calibrationSucceeds: boolean;
}

interface VariantDefinition {
  state?: DeepPartial<StudioState>;
  live?: Partial<LiveReadouts>;
  calibrationSucceeds?: boolean;
}

const BACKING_FILE: SongFile = {
  name: 'Midnight City (Instrumental).mp3',
  path: '/Users/singer/Music/Midnight City (Instrumental).mp3',
  durationSec: 243,
};

const REFERENCE_FILE: SongFile = {
  name: 'Midnight City.m4a',
  path: '/Users/singer/Music/Midnight City.m4a',
  durationSec: 244,
};

/** A singer whose devices all work: the starting point every variant adjusts. */
const SET_UP: DeepPartial<StudioState> = {
  phase: 'wizard',
  permissions: { microphone: 'granted', camera: 'granted' },
  devices: {
    microphones: [
      { id: 'mic-built-in', label: 'MacBook Pro Microphone' },
      { id: 'mic-usb', label: 'Scarlett Solo USB' },
    ],
    cameras: [
      { id: 'cam-built-in', label: 'FaceTime HD Camera' },
      { id: 'cam-usb', label: 'Logitech StreamCam' },
    ],
    outputs: [
      { id: 'out-speakers', label: 'MacBook Pro Speakers' },
      { id: 'out-headphones', label: 'AirPods Pro' },
    ],
    outputSelectionSupported: true,
  },
  settings: { mode: 'video' },
  engine: { status: 'running' },
  camera: { status: 'running', width: 1280, height: 720 },
  tracking: { status: 'running' },
};

const AUDIO_ONLY: DeepPartial<StudioState> = {
  settings: { mode: 'audio' },
  camera: { status: 'off', width: 0, height: 0 },
  tracking: { status: 'off' },
};

function hand(side: HandSide, status: HandStatus, openness: number, proximity: number): HandState {
  const isSeen = status === 'tracking';
  return {
    side,
    status,
    openness,
    proximity,
    scale: isSeen ? 0.2 : 0,
    confidence: isSeen ? 0.94 : 0,
    landmarks: null,
  };
}

function gesture(left: HandStatus, right: HandStatus): GestureFrame {
  return {
    timestampMs: 0,
    left: hand('left', left, 0.35, 0.5),
    right: hand('right', right, 0.72, 0.58),
  };
}

const NO_HANDS: Partial<LiveReadouts> = {
  controls: { autotune: 0.5, echo: 0, volume: 0.5 },
  controlStatus: { autotune: 'manual', echo: 'manual', volume: 'manual' },
  gesture: gesture('lost', 'lost'),
};

const RIGHT_HAND: Partial<LiveReadouts> = {
  controls: { autotune: 0.72, echo: 0, volume: 0.58 },
  controlStatus: { autotune: 'gesture', echo: 'manual', volume: 'gesture' },
  gesture: gesture('lost', 'tracking'),
};

const BOTH_HANDS: Partial<LiveReadouts> = {
  controls: { autotune: 0.72, echo: 0.35, volume: 0.58 },
  controlStatus: { autotune: 'gesture', echo: 'gesture', volume: 'gesture' },
  gesture: gesture('tracking', 'tracking'),
};

const QUIET_ROOM: Partial<LiveReadouts> = { inputLevel: 0.003 };
const SINGING: Partial<LiveReadouts> = { inputLevel: 0.32 };

const ANALYZING: DeepPartial<StudioState> = {
  reference: { status: 'analyzing', file: REFERENCE_FILE, progress: 0.4 },
};

const REFERENCE_READY: DeepPartial<StudioState> = {
  reference: {
    status: 'ready',
    file: REFERENCE_FILE,
    progress: 1,
    keyLabel: 'A minor',
    melodyUsable: true,
  },
};

const REFERENCE_FAILED: DeepPartial<StudioState> = {
  reference: {
    status: 'failed',
    file: REFERENCE_FILE,
    error: createAppError('analysis-failed', 'no voiced frames'),
  },
};

/** Every variant of every step. The first variant of a step is its default. */
export const PREVIEW_VARIANTS: Record<WizardStepId, Record<string, VariantDefinition>> = {
  microphone: {
    granted: { live: SINGING },
    ask: {
      state: { permissions: { microphone: 'not-determined' }, engine: { status: 'off' } },
    },
    denied: {
      state: {
        permissions: { microphone: 'denied' },
        engine: { status: 'error', error: createAppError('microphone-permission-denied') },
      },
    },
    starting: { state: { engine: { status: 'starting' } } },
    'no-devices': {
      state: {
        devices: { microphones: [] },
        engine: { status: 'error', error: createAppError('no-microphone') },
      },
    },
    error: {
      state: {
        engine: { status: 'error', error: createAppError('audio-engine-failed', 'NotReadable') },
      },
    },
  },
  mode: {
    video: {},
    audio: { state: AUDIO_ONLY },
    'camera-ask': {
      state: { permissions: { camera: 'not-determined' }, camera: { status: 'off' } },
    },
    'camera-denied': {
      state: {
        permissions: { camera: 'denied' },
        camera: { status: 'error', error: createAppError('camera-permission-denied') },
      },
    },
    'camera-starting': { state: { camera: { status: 'starting' } } },
    'camera-error': {
      state: {
        camera: { status: 'error', error: createAppError('device-disconnected', 'track ended') },
      },
    },
    'no-camera': {
      state: {
        devices: { cameras: [] },
        camera: { status: 'error', error: createAppError('no-camera') },
      },
    },
  },
  headphones: {
    choose: { state: { settings: { devices: { outputId: 'out-headphones' } } } },
    fixed: { state: { devices: { outputs: [], outputSelectionSupported: false } } },
  },
  'mic-test': {
    listening: { live: QUIET_ROOM },
    passed: { live: SINGING },
    error: {
      state: {
        engine: { status: 'error', error: createAppError('device-disconnected', 'ended') },
      },
    },
  },
  'headphone-test': {
    ready: {},
  },
  monitoring: {
    on: {
      // Monitoring still off and echo following the hand, as the earlier steps leave them.
      state: {
        settings: {
          audio: { monitoringEnabled: false },
          controls: { echo: { source: 'gesture', manual: 0.2 } },
        },
      },
      live: SINGING,
    },
    error: {
      state: { engine: { status: 'error', error: createAppError('audio-engine-failed') } },
    },
  },
  hands: {
    both: { live: BOTH_HANDS, calibrationSucceeds: true },
    none: { live: NO_HANDS },
    one: { live: RIGHT_HAND, calibrationSucceeds: true },
    error: {
      state: {
        tracking: { status: 'error', error: createAppError('hand-tracking-failed', 'wasm') },
      },
      live: { ...NO_HANDS, gesture: null },
    },
  },
  backing: {
    none: {},
    loading: { state: { backing: { status: 'loading', file: BACKING_FILE } } },
    ready: { state: { backing: { status: 'ready', file: BACKING_FILE } } },
    failed: {
      state: {
        backing: {
          status: 'failed',
          file: { ...BACKING_FILE, name: 'Voice memo.amr' },
          error: createAppError('unsupported-audio-file', 'EncodingError'),
        },
      },
    },
  },
  reference: {
    none: { state: { backing: { status: 'ready', file: BACKING_FILE } } },
    analyzing: { state: ANALYZING },
    ready: { state: REFERENCE_READY },
    failed: { state: REFERENCE_FAILED },
  },
  melody: {
    analyzing: { state: ANALYZING },
    loading: { state: { reference: { status: 'loading', file: REFERENCE_FILE } } },
    ready: { state: REFERENCE_READY },
    'key-only': {
      state: deepMerge(REFERENCE_READY, {
        reference: { keyLabel: 'F♯ minor', melodyUsable: false },
      }),
    },
    failed: { state: REFERENCE_FAILED },
  },
  ready: {
    video: {
      state: deepMerge(REFERENCE_READY, {
        settings: {
          devices: {
            microphoneId: 'mic-usb',
            cameraId: 'cam-built-in',
            outputId: 'out-headphones',
          },
        },
        backing: { status: 'ready', file: BACKING_FILE },
      }),
    },
    audio: { state: AUDIO_ONLY },
  },
};

export interface PreviewSelection {
  step: WizardStepId;
  variant: string;
}

function defaultVariant(step: WizardStepId): string {
  return Object.keys(PREVIEW_VARIANTS[step])[0] ?? '';
}

/**
 * Reads "#step=4&variant=passed". The step is its number (1–11) or its id; an unknown
 * step opens the first one and an unknown variant falls back to the step's default.
 */
export function parsePreviewHash(hash: string): PreviewSelection {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const requested = params.get('step') ?? '';
  const byNumber = WIZARD_STEP_IDS[Number(requested) - 1];
  const step = isWizardStepId(requested) ? requested : (byNumber ?? 'microphone');

  const variant = params.get('variant') ?? '';
  const isKnown = Object.hasOwn(PREVIEW_VARIANTS[step], variant);
  return { step, variant: isKnown ? variant : defaultVariant(step) };
}

export function previewFixture({ step, variant }: PreviewSelection): WizardPreviewFixture {
  const definition = PREVIEW_VARIANTS[step][variant] ?? {};
  return {
    step,
    variant,
    state: deepMerge(SET_UP, definition.state ?? {}),
    live: definition.live ?? {},
    calibrationSucceeds: definition.calibrationSucceeds ?? false,
  };
}
