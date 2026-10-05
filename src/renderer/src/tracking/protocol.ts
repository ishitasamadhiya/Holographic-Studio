// Messages exchanged between HandTracker (UI thread) and the hand-landmarker worker.
import type { RawHandFrame } from '@gestures/types';

export type InferenceDelegate = 'GPU' | 'CPU';

export type TrackerRequest =
  | {
      type: 'init';
      /** Absolute URL of the folder holding MediaPipe's WASM runtime. */
      wasmBaseUrl: string;
      /** Absolute URL of the hand-landmarker model. */
      modelUrl: string;
      /** Tried first; the worker falls back to CPU by itself when GPU cannot be used. */
      preferredDelegate: InferenceDelegate;
    }
  | {
      type: 'frame';
      /** Transferred to the worker, which closes it. */
      bitmap: ImageBitmap;
      timestampMs: number;
      /** Aspect ratio of the full camera image (the bitmap is a downscaled copy). */
      imageAspect: number;
    };

export type TrackerResponse =
  | { type: 'ready'; delegate: InferenceDelegate }
  | { type: 'result'; frame: RawHandFrame; inferenceMs: number; delegate: InferenceDelegate }
  | { type: 'failed'; detail: string };
