// Runs MediaPipe's HandLandmarker off the UI thread. It receives downscaled camera frames
// one at a time and answers each with the raw landmarks; all interpretation is in src/gestures.
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import type { Landmark, RawHand } from '@gestures/types';
import type { InferenceDelegate, TrackerRequest, TrackerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

interface MediaPipeLoaderHooks {
  import?: (url: string) => Promise<void>;
  ModuleFactory?: unknown;
}

// MediaPipe loads its WASM glue script with importScripts(), which module workers do not have,
// and then falls back to this `self.import` hook. The hook also re-registers the script's
// factory on every call: an ES module is evaluated only once, so without this a second
// HandLandmarker (the CPU fallback) would find the factory already consumed.
const loaderHooks = self as unknown as MediaPipeLoaderHooks;
loaderHooks.import = async (url) => {
  const glue = (await import(/* @vite-ignore */ url)) as { default: unknown };
  loaderHooks.ModuleFactory = glue.default;
};

interface ModelSource {
  wasmBaseUrl: string;
  modelUrl: string;
}

let source: ModelSource | null = null;
let landmarker: HandLandmarker | null = null;
let delegate: InferenceDelegate = 'GPU';

function post(message: TrackerResponse): void {
  scope.postMessage(message);
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function createLandmarker(from: ModelSource, using: InferenceDelegate): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks(from.wasmBaseUrl, true);
  landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: from.modelUrl, delegate: using },
    runningMode: 'VIDEO',
    numHands: 2,
  });
  delegate = using;
}

async function switchToCpu(from: ModelSource): Promise<void> {
  landmarker?.close();
  landmarker = null;
  await createLandmarker(from, 'CPU');
}

async function startLandmarker(from: ModelSource, preferred: InferenceDelegate): Promise<void> {
  try {
    await createLandmarker(from, preferred);
  } catch (error) {
    if (preferred === 'CPU') throw error;
    // Most failures here are the GPU's, but a missing asset fails the same way; the CPU attempt
    // then fails too and that error is the one reported.
    console.warn(`Hand tracking: GPU start failed, retrying on CPU (${describe(error)})`);
    await switchToCpu(from);
  }
}

async function initialize(from: ModelSource, preferred: InferenceDelegate): Promise<void> {
  source = from;
  try {
    await startLandmarker(from, preferred);
  } catch (error) {
    throw new Error(`${describe(error)} (model ${from.modelUrl}, runtime ${from.wasmBaseUrl})`);
  }
}

function toPoint(landmark: NormalizedLandmark): Landmark {
  return { x: landmark.x, y: landmark.y, z: landmark.z };
}

function toRawHands(result: HandLandmarkerResult): RawHand[] {
  const hands: RawHand[] = [];
  result.landmarks.forEach((landmarks, index) => {
    const worldLandmarks = result.worldLandmarks[index];
    const handedness = result.handedness[index]?.[0];
    if (!worldLandmarks || !handedness) return;
    hands.push({
      landmarks: landmarks.map(toPoint),
      worldLandmarks: worldLandmarks.map(toPoint),
      label: handedness.categoryName === 'Left' ? 'Left' : 'Right',
      score: handedness.score,
    });
  });
  return hands;
}

async function detect(bitmap: ImageBitmap, timestampMs: number): Promise<HandLandmarkerResult> {
  if (!landmarker || !source) throw new Error('Hand tracker received a frame before it was ready');
  try {
    return landmarker.detectForVideo(bitmap, timestampMs);
  } catch (error) {
    // A GPU context can be lost while running (driver reset, sleep/wake); carry on with CPU.
    if (delegate === 'CPU') throw error;
    console.warn(`Hand tracking: GPU inference failed, switching to CPU (${describe(error)})`);
    await switchToCpu(source);
    if (!landmarker) throw error;
    return landmarker.detectForVideo(bitmap, timestampMs);
  }
}

async function handleFrame(
  request: Extract<TrackerRequest, { type: 'frame' }>,
): Promise<TrackerResponse> {
  const startedAt = performance.now();
  try {
    const result = await detect(request.bitmap, request.timestampMs);
    return {
      type: 'result',
      frame: {
        timestampMs: request.timestampMs,
        imageAspect: request.imageAspect,
        hands: toRawHands(result),
      },
      inferenceMs: performance.now() - startedAt,
      delegate,
    };
  } finally {
    request.bitmap.close();
  }
}

async function handleRequest(request: TrackerRequest): Promise<TrackerResponse> {
  if (request.type === 'frame') return handleFrame(request);
  await initialize(
    { wasmBaseUrl: request.wasmBaseUrl, modelUrl: request.modelUrl },
    request.preferredDelegate,
  );
  return { type: 'ready', delegate };
}

scope.onmessage = (event: MessageEvent<TrackerRequest>) => {
  handleRequest(event.data).then(post, (error: unknown) =>
    post({ type: 'failed', detail: describe(error) }),
  );
};
