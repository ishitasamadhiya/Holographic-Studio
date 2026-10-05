// Developer page: runs the hand tracker against the camera and shows what it sees — the
// landmark overlay, both hands' gesture values and the control values they resolve to.
// Open with HOLO_E2E_PAGE=tracking-probe.html (see docs/TESTING.md). Add ?delegate=cpu to the
// page name to force CPU inference.
import {
  ControlResolver,
  deriveNeutralHandScale,
  ExtraGestureDetector,
  GesturePipeline,
  type ExtraGestureEvent,
  type GestureFrame,
  type HandState,
  type RawHandFrame,
  type ResolvedControls,
} from '@gestures/index';
import { drawLandmarks } from '@renderer/tracking/drawLandmarks';
import { HandTracker } from '@renderer/tracking/handTracker';
import type { InferenceDelegate } from '@renderer/tracking/protocol';
import { CONTROL_IDS } from '@shared/controls';
import { DEFAULT_SETTINGS } from '@shared/settings';

/** Published as window.__trackingProbe for the end-to-end tests and the DevTools console. */
interface TrackingProbe {
  /** Tracker results received so far. */
  frames: number;
  lastRaw: RawHandFrame | null;
  lastGesture: GestureFrame | null;
  /** Duration of the latest inference inside the worker. */
  inferenceMs: number;
  error: string | null;
  /** Tracker results per second over the last second. */
  fps: number;
  delegate: InferenceDelegate | null;
  /** Controls resolved with the default settings (every control gesture-driven). */
  controls: ResolvedControls | null;
  /** Every extra gesture detected so far, oldest first. */
  extraGestures: ExtraGestureEvent[];
}

const CALIBRATION_MS = 2000;

const probe: TrackingProbe = {
  frames: 0,
  lastRaw: null,
  lastGesture: null,
  inferenceMs: 0,
  error: null,
  fps: 0,
  delegate: null,
  controls: null,
  extraGestures: [],
};
Object.assign(window, { __trackingProbe: probe });

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent.append(node);
  return node;
}

function describeHand(hand: HandState): string {
  const value = (number: number): string => number.toFixed(2);
  return (
    `${hand.side.padEnd(5)} ${hand.status.padEnd(8)} ` +
    `openness ${value(hand.openness)}  proximity ${value(hand.proximity)}  ` +
    `scale ${hand.scale.toFixed(3)}  confidence ${value(hand.confidence)}`
  );
}

function describeProbe(): string {
  const lines = [
    probe.error ? `ERROR  ${probe.error}` : `tracker ${probe.delegate ?? 'starting…'}`,
    `${probe.fps.toFixed(0)} fps   inference ${probe.inferenceMs.toFixed(1)} ms   frames ${probe.frames}`,
  ];
  if (probe.lastGesture) {
    lines.push('', describeHand(probe.lastGesture.left), describeHand(probe.lastGesture.right));
  }
  if (probe.controls) {
    lines.push('');
    for (const control of CONTROL_IDS) {
      const value = probe.controls.values[control].toFixed(2);
      lines.push(`${control.padEnd(9)} ${value}  ${probe.controls.status[control]}`);
    }
  }
  if (probe.extraGestures.length > 0) {
    lines.push('', `extra gestures: ${probe.extraGestures.join(', ')}`);
  }
  return lines.join('\n');
}

async function openCamera(video: HTMLVideoElement): Promise<void> {
  video.srcObject = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  await video.play();
}

async function run(root: HTMLElement): Promise<void> {
  const stage = element('div', 'stage', root);
  const video = element('video', 'preview', stage);
  const overlay = element('canvas', 'overlay', stage);
  const calibrate = element('button', 'calibrate', root);
  const readout = element('pre', 'readout', root);
  video.muted = true;
  video.playsInline = true;
  calibrate.textContent = 'Calibrate resting distance (hold still for 2 s)';

  const preferCpu = new URLSearchParams(window.location.search).get('delegate') === 'cpu';
  const tracker = new HandTracker({ delegate: preferCpu ? 'CPU' : 'GPU' });
  const pipeline = new GesturePipeline();
  const resolver = new ControlResolver();
  const extraGestures = new ExtraGestureDetector();
  const overlayContext = overlay.getContext('2d');
  const controlConfig = { gesturesAvailable: true, controls: DEFAULT_SETTINGS.controls };
  const recentFrameTimes: number[] = [];
  let calibrationFrames: GestureFrame[] | null = null;

  tracker.onError((error) => {
    probe.error = `${error.code}: ${error.detail ?? error.message}`;
    readout.textContent = describeProbe();
  });

  tracker.onFrame((raw) => {
    const gesture = pipeline.update(raw);
    probe.frames += 1;
    probe.lastRaw = raw;
    probe.lastGesture = gesture;
    probe.inferenceMs = tracker.inferenceMs;
    probe.delegate = tracker.delegate;
    probe.extraGestures.push(...extraGestures.update(gesture, raw));
    calibrationFrames?.push(gesture);

    recentFrameTimes.push(raw.timestampMs);
    while ((recentFrameTimes[0] ?? raw.timestampMs) < raw.timestampMs - 1000) {
      recentFrameTimes.shift();
    }
    probe.fps = recentFrameTimes.length;
  });

  calibrate.addEventListener('click', () => {
    if (calibrationFrames) return;
    const frames: GestureFrame[] = [];
    calibrationFrames = frames;
    calibrate.textContent = 'Calibrating…';
    window.setTimeout(() => {
      calibrationFrames = null;
      const neutralScale = deriveNeutralHandScale(frames);
      if (neutralScale !== null) pipeline.setNeutralHandScale(neutralScale);
      calibrate.textContent =
        neutralScale === null
          ? 'No hand was seen — try again'
          : `Resting hand scale ${neutralScale.toFixed(3)} — calibrate again`;
    }, CALIBRATION_MS);
  });

  // Controls are resolved on every display frame, as the app does, so that holds and returns
  // keep moving even while the tracker has nothing new to say.
  const render = (nowMs: number): void => {
    probe.controls = resolver.resolve(probe.lastGesture, controlConfig, nowMs);
    if (overlayContext && video.videoWidth > 0) {
      if (overlay.width !== video.videoWidth) overlay.width = video.videoWidth;
      if (overlay.height !== video.videoHeight) overlay.height = video.videoHeight;
      // The preview is mirrored with CSS; the overlay canvas is not, so the drawing is flipped.
      drawLandmarks(overlayContext, probe.lastGesture, { mirrored: true });
    }
    readout.textContent = describeProbe();
    window.requestAnimationFrame(render);
  };
  window.requestAnimationFrame(render);

  try {
    await openCamera(video);
  } catch (error) {
    probe.error = `camera: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  await tracker.start(video);
}

const root = document.getElementById('root');
if (root) void run(root);
