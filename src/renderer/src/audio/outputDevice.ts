// Creating the AudioContext with the lowest latency this machine offers, and routing it to
// a chosen output device.
import { ENGINE_SAMPLE_RATE } from './engineConstants';

/** AudioContext.setSinkId is implemented by Chromium but missing from TypeScript's DOM typings. */
type SinkSelectableContext = AudioContext & { setSinkId(sinkId: string): Promise<void> };

export type LatencyHint = AudioContextLatencyCategory | number;

/**
 * Tried in order; the first one wins a tie. 'interactive' is the platform's own low-latency
 * choice; a numeric hint of 0 asks for the smallest buffer the device supports, which on
 * some devices is smaller still.
 */
const LATENCY_HINT_CANDIDATES: readonly LatencyHint[] = ['interactive', 0];

/** Buffers closer than this (a fraction of a frame) count as the same size. */
const LATENCY_TIE_SEC = 1e-5;

export function supportsOutputSelection(): boolean {
  return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
}

function canSelectOutput(context: AudioContext): context is SinkSelectableContext {
  return 'setSinkId' in context;
}

/**
 * Routes the context to an output device (null = system default). A device that cannot be
 * used — typically one remembered from an earlier session and since unplugged — falls back
 * to the default output. Returns false only when no output could be selected at all.
 */
export async function routeOutput(
  context: AudioContext,
  deviceId: string | null,
): Promise<boolean> {
  if (!canSelectOutput(context)) return deviceId === null;
  if (deviceId !== null) {
    try {
      await context.setSinkId(deviceId);
      return true;
    } catch {
      // Fall through to the default device.
    }
  }
  try {
    await context.setSinkId('');
    return true;
  } catch {
    return false;
  }
}

async function openContext(
  latencyHint: LatencyHint,
  outputId: string | null,
): Promise<AudioContext> {
  let context: AudioContext;
  try {
    context = new AudioContext({ sampleRate: ENGINE_SAMPLE_RATE, latencyHint });
  } catch {
    // A device that cannot run at the engine rate: let the context pick its own.
    context = new AudioContext({ latencyHint });
  }
  if (outputId !== null) await routeOutput(context, outputId);
  return context;
}

export interface OpenedContext {
  context: AudioContext;
  latencyHint: LatencyHint;
}

/**
 * Opens an AudioContext on the given output. With `knownHint` it is used directly; without,
 * every candidate hint is tried on the real device and the one with the smallest output
 * buffer (`baseLatency`) is kept, so the caller can remember it for the next start.
 */
export async function openLowLatencyContext(
  outputId: string | null,
  knownHint?: LatencyHint,
): Promise<OpenedContext> {
  if (knownHint !== undefined) {
    return { context: await openContext(knownHint, outputId), latencyHint: knownHint };
  }

  let best: OpenedContext | null = null;
  let failure: unknown = new Error('No AudioContext could be created');
  for (const latencyHint of LATENCY_HINT_CANDIDATES) {
    let context: AudioContext;
    try {
      context = await openContext(latencyHint, outputId);
    } catch (error) {
      failure = error;
      continue;
    }
    if (best === null || context.baseLatency < best.context.baseLatency - LATENCY_TIE_SEC) {
      void best?.context.close();
      best = { context, latencyHint };
    } else {
      void context.close();
    }
  }
  if (best === null) throw failure;
  return best;
}
