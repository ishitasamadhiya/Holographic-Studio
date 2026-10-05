// Fixed app states for reviewing and testing the studio screen without devices (see
// src/renderer/src/dev/studioPreview.tsx). Pure data, so it can be checked in unit tests.
import type { GestureFrame, HandState, Landmark } from '@gestures/index';
import type { ControlId } from '@shared/controls';
import { createAppError } from '@shared/errors';
import type { DeepPartial } from '@shared/settings';
import { deepMerge } from '@renderer/state/staticStudio';
import type { ControlStatus, LiveReadouts, StudioState } from '@renderer/state/studioTypes';

export const STUDIO_FIXTURE_IDS = [
  'idle',
  'idle-songs',
  'audio',
  'countdown',
  'recording',
  'paused',
  'finishing',
  'review',
  'review-error',
  'exporting',
  'saved',
  'mic-denied',
  'camera-denied',
  'camera-error',
  'tracking-error',
  'analyzing',
  'key-only',
  'reference-failed',
  'hands-lost',
  'notice',
  'controls',
  'settings',
  'landmarks',
] as const;

export type StudioFixtureId = (typeof STUDIO_FIXTURE_IDS)[number];

/** Something the screen itself shows open, as if the singer had clicked it. */
export type StudioOverlay = 'controls' | 'settings';

export interface StudioFixture {
  id: StudioFixtureId;
  state: DeepPartial<StudioState>;
  live: Partial<LiveReadouts>;
  /** The live readouts move as they would during a performance (see animateLive). */
  animate: boolean;
  overlay: StudioOverlay | null;
}

export function isStudioFixtureId(value: string): value is StudioFixtureId {
  return (STUDIO_FIXTURE_IDS as readonly string[]).includes(value);
}

/** "#state=recording" → 'recording'; anything unknown shows the plain idle studio. */
export function parseFixtureHash(hash: string): StudioFixtureId {
  const state = new URLSearchParams(hash.replace(/^#/, '')).get('state') ?? '';
  return isStudioFixtureId(state) ? state : 'idle';
}

const BACKING_FILE = {
  name: 'Midnight City (Instrumental).mp3',
  path: '/Users/singer/Music/Midnight City (Instrumental).mp3',
  durationSec: 243,
};

const REFERENCE_FILE = {
  name: 'Midnight City.mp3',
  path: '/Users/singer/Music/Midnight City.mp3',
  durationSec: 244,
};

const SONGS: DeepPartial<StudioState> = {
  backing: { status: 'ready', file: BACKING_FILE },
  reference: {
    status: 'ready',
    file: REFERENCE_FILE,
    progress: 1,
    keyLabel: 'A minor',
    melodyUsable: true,
  },
};

/** A healthy studio in Video mode: everything granted, running and tracking. */
const BASE_STATE: DeepPartial<StudioState> = {
  phase: 'studio',
  appInfo: { version: '0.1.0', platform: 'darwin', isE2E: true },
  settings: { onboardingComplete: true },
  devices: {
    microphones: [
      { id: 'mic-usb', label: 'Scarlett Solo USB' },
      { id: 'mic-built-in', label: 'MacBook Pro Microphone' },
    ],
    cameras: [{ id: 'cam-built-in', label: 'FaceTime HD Camera' }],
    outputs: [
      { id: 'out-headphones', label: 'AirPods Pro' },
      { id: 'out-speakers', label: 'MacBook Pro Speakers' },
    ],
    outputSelectionSupported: true,
  },
  permissions: { microphone: 'granted', camera: 'granted' },
  engine: { status: 'running', monitoringLatencyMs: 23.6 },
  camera: { status: 'running', width: 1280, height: 720 },
  tracking: { status: 'running' },
};

/** 21 hand landmarks in camera-image coordinates (0..1, not mirrored). */
function handLandmarks(wristX: number, wristY: number, side: 'left' | 'right', openness: number) {
  // In the un-mirrored camera image the performer's right hand has its thumb on the right.
  const flip = side === 'right' ? 1 : -1;
  const aspect = 9 / 16;
  const fingers = [
    { angle: 52, lengths: [0.05, 0.045, 0.035, 0.03] },
    { angle: 16, lengths: [0.11, 0.055, 0.035, 0.03] },
    { angle: 0, lengths: [0.11, 0.06, 0.04, 0.032] },
    { angle: -14, lengths: [0.105, 0.055, 0.037, 0.03] },
    { angle: -28, lengths: [0.095, 0.042, 0.03, 0.026] },
  ];
  const points: Landmark[] = [{ x: wristX, y: wristY, z: 0 }];
  for (const finger of fingers) {
    const radians = (finger.angle * flip * Math.PI) / 180;
    let x = wristX;
    let y = wristY;
    finger.lengths.forEach((length, joint) => {
      // A closing hand folds its fingers from the first knuckle on.
      const reach = joint === 0 ? length : length * (0.25 + 0.75 * openness);
      x += Math.sin(radians) * reach * aspect;
      y -= Math.cos(radians) * reach;
      points.push({ x, y, z: 0 });
    });
  }
  return points;
}

function hand(
  side: 'left' | 'right',
  status: HandState['status'],
  openness = 0.7,
  position: { x: number; y: number } = side === 'right' ? { x: 0.3, y: 0.62 } : { x: 0.7, y: 0.6 },
): HandState {
  const seen = status !== 'lost';
  return {
    side,
    status,
    openness,
    proximity: 0.5,
    scale: seen ? 0.12 : 0,
    confidence: seen ? 0.95 : 0,
    landmarks: seen ? handLandmarks(position.x, position.y, side, openness) : null,
  };
}

function gestureFrame(left: HandState['status'], right: HandState['status']): GestureFrame {
  return { timestampMs: 0, left: hand('left', left), right: hand('right', right) };
}

function allStatuses(status: ControlStatus): Record<ControlId, ControlStatus> {
  return { autotune: status, echo: status, volume: status };
}

const TRACKED_LIVE: Partial<LiveReadouts> = {
  controls: { autotune: 0.62, echo: 0.28, volume: 0.5 },
  controlStatus: allStatuses('gesture'),
  gesture: gestureFrame('tracking', 'tracking'),
  inputLevel: 0.3,
  outputLevel: 0.3,
};

function recordingState(
  status: StudioState['recording']['status'],
  extra: DeepPartial<StudioState['recording']> = {},
): DeepPartial<StudioState> {
  return { ...SONGS, recording: { status, ...extra } };
}

type FixtureParts = Partial<Omit<StudioFixture, 'id'>>;

function fixtureParts(id: StudioFixtureId): FixtureParts {
  switch (id) {
    case 'idle':
      return {};
    case 'idle-songs':
      return { state: SONGS };
    case 'audio':
      return {
        state: {
          ...SONGS,
          settings: { mode: 'audio' },
          camera: { status: 'off', width: 0, height: 0 },
          tracking: { status: 'off' },
        },
        live: { controlStatus: allStatuses('manual'), gesture: null },
        animate: true,
      };
    case 'countdown':
      return { state: recordingState('countdown', { countdownRemaining: 3 }) };
    case 'recording':
      return {
        state: recordingState('recording'),
        live: { recordingElapsedSec: 83.2 },
        animate: true,
      };
    case 'paused':
      return {
        state: recordingState('paused'),
        live: { recordingElapsedSec: 47.3, controlStatus: allStatuses('holding') },
      };
    case 'finishing':
      return { state: recordingState('finishing'), live: { recordingElapsedSec: 84.6 } };
    case 'review':
      return { state: recordingState('review', { takeDurationSec: 84.6 }) };
    case 'review-error':
      return {
        state: recordingState('review', {
          takeDurationSec: 84.6,
          error: createAppError('export-failed'),
        }),
      };
    case 'exporting':
      return {
        state: recordingState('exporting', {
          takeDurationSec: 84.6,
          exportStage: 'encoding',
          exportProgress: 0.45,
        }),
      };
    case 'saved':
      return {
        state: recordingState('saved', {
          takeDurationSec: 84.6,
          exportProgress: 1,
          savedPath: '/Users/singer/Movies/Holographic-Studio-Take-2026-10-05-1432.mp4',
        }),
      };
    case 'mic-denied':
      return {
        state: {
          permissions: { microphone: 'denied' },
          engine: {
            status: 'error',
            error: createAppError('microphone-permission-denied'),
            monitoringLatencyMs: null,
          },
        },
      };
    case 'camera-denied':
      return {
        state: {
          permissions: { camera: 'denied' },
          camera: { status: 'error', error: createAppError('camera-permission-denied') },
          tracking: { status: 'off' },
        },
        live: { controlStatus: allStatuses('manual'), gesture: null },
      };
    case 'camera-error':
      return {
        state: {
          camera: { status: 'error', error: createAppError('no-camera') },
          tracking: { status: 'off' },
        },
        live: { controlStatus: allStatuses('manual'), gesture: null },
      };
    case 'tracking-error':
      return {
        state: {
          ...SONGS,
          tracking: { status: 'error', error: createAppError('hand-tracking-failed') },
        },
        // Without tracking every control sits on its slider (the default settings).
        live: {
          controls: { autotune: 0.5, echo: 0, volume: 0.5 },
          controlStatus: allStatuses('manual'),
          gesture: null,
        },
      };
    case 'analyzing':
      return {
        state: {
          backing: SONGS.backing,
          reference: { status: 'analyzing', file: REFERENCE_FILE, progress: 0.42 },
        },
      };
    case 'key-only':
      return {
        state: { ...SONGS, reference: { ...SONGS.reference, melodyUsable: false } },
      };
    case 'reference-failed':
      return {
        state: {
          backing: SONGS.backing,
          reference: {
            status: 'failed',
            file: REFERENCE_FILE,
            error: createAppError('analysis-failed'),
          },
        },
      };
    case 'hands-lost':
      return {
        state: SONGS,
        live: {
          controls: { autotune: 0.5, echo: 0, volume: 0.5 },
          controlStatus: allStatuses('manual'),
          gesture: gestureFrame('lost', 'lost'),
        },
      };
    case 'notice':
      return {
        state: {
          ...SONGS,
          notices: [
            {
              id: 'device-changed',
              kind: 'warning',
              message: 'Your headphones were disconnected. Sound now plays through the speakers.',
            },
          ],
        },
      };
    case 'controls':
      return { state: SONGS, overlay: 'controls' };
    case 'settings':
      return { state: SONGS, overlay: 'settings' };
    case 'landmarks':
      return {
        state: { ...SONGS, settings: { developer: { showLandmarks: true } } },
        animate: true,
      };
  }
}

export function studioFixture(id: StudioFixtureId): StudioFixture {
  const parts = fixtureParts(id);
  return {
    id,
    state: deepMerge(BASE_STATE, parts.state ?? {}),
    live: { ...TRACKED_LIVE, ...parts.live },
    animate: parts.animate ?? false,
    overlay: parts.overlay ?? null,
  };
}

/**
 * Moves the live readouts as a performance would: hands drifting, a voice rising and falling,
 * the take clock running while recording. `timeSec` is the time since the page opened.
 */
export function animateLive(
  live: LiveReadouts,
  timeSec: number,
  deltaSec: number,
  recording: boolean,
): void {
  const wave = (speed: number, phase: number) => 0.5 + 0.5 * Math.sin(timeSec * speed + phase);
  const autotune = 0.25 + 0.6 * wave(0.9, 0);
  const echo = 0.1 + 0.5 * wave(0.6, 1.7);
  live.controls = { autotune, echo, volume: 0.38 + 0.26 * wave(0.45, 3.1) };

  const voice = Math.max(0, Math.sin(timeSec * 2.3)) * (0.45 + 0.35 * wave(5.1, 0.4));
  live.inputLevel = voice;
  live.outputLevel = voice;
  if (recording) live.recordingElapsedSec += deltaSec;

  if (live.gesture) {
    const sway = Math.sin(timeSec * 0.8) * 0.03;
    live.gesture = {
      timestampMs: timeSec * 1000,
      right: hand('right', 'tracking', autotune, { x: 0.3 + sway, y: 0.62 - sway }),
      left: hand('left', 'tracking', echo / 0.6, { x: 0.7 - sway, y: 0.6 + sway }),
    };
  }
}
