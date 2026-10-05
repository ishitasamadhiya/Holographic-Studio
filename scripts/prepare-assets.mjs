// Runs after `npm install`.
// 1. Copies the MediaPipe WASM runtime out of node_modules so the renderer can load it locally.
// 2. Makes sure the hand-tracking model is present (it is committed to the repo; this is a fallback).
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(root, 'src/renderer/public');
const wasmSource = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmTarget = resolve(publicDir, 'mediapipe/wasm');
const modelTarget = resolve(publicDir, 'models/hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyWasmRuntime() {
  if (!(await exists(wasmSource))) {
    console.warn('[prepare-assets] MediaPipe package not found yet; skipping WASM copy.');
    return;
  }
  await mkdir(wasmTarget, { recursive: true });
  await cp(wasmSource, wasmTarget, { recursive: true });
  console.log('[prepare-assets] MediaPipe WASM runtime ready.');
}

async function ensureHandModel() {
  if (await exists(modelTarget)) {
    console.log('[prepare-assets] Hand-tracking model ready.');
    return;
  }
  console.log('[prepare-assets] Downloading hand-tracking model...');
  try {
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await mkdir(dirname(modelTarget), { recursive: true });
    await writeFile(modelTarget, Buffer.from(await response.arrayBuffer()));
    console.log('[prepare-assets] Hand-tracking model downloaded.');
  } catch (error) {
    console.warn(
      `[prepare-assets] Could not download the hand-tracking model (${error.message}).\n` +
        `  Download it manually from:\n  ${MODEL_URL}\n  and save it to:\n  ${modelTarget}`,
    );
  }
}

await copyWasmRuntime();
await ensureHandModel();
