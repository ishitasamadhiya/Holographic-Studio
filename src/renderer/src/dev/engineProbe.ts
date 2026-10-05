// Developer page: runs the audio engine on its own, shows its meters and latency, and exposes
// it as window.__engineProbe for tests/e2e/engine.spec.ts. Open with
// HOLO_E2E_PAGE=engine-probe.html (see docs/TESTING.md).
//
// The page watches the engine from outside: it records the AudioContexts, microphone streams
// and the master soft clipper the engine creates, so tests can inspect them without the
// engine exposing any of it.
import type { AppError } from '@shared/errors';
import { STEM_BYTES_PER_FRAME, STEM_CHANNELS, type TakeAudioChunk } from '@shared/take';
import { createAudioEngine } from '@renderer/audio/createAudioEngine';
import type { EngineMeters } from '@renderer/audio/engineTypes';
import { computeMonitoringLatencySec } from '@renderer/recording/syncTimeline';

const contexts: AudioContext[] = [];
const NativeAudioContext = globalThis.AudioContext;
globalThis.AudioContext = class TrackedAudioContext extends NativeAudioContext {
  constructor(options?: AudioContextOptions) {
    super(options);
    contexts.push(this);
  }
};

const shapers: WaveShaperNode[] = [];
const NativeWaveShaperNode = globalThis.WaveShaperNode;
globalThis.WaveShaperNode = class TrackedWaveShaperNode extends NativeWaveShaperNode {
  constructor(context: BaseAudioContext, options?: WaveShaperOptions) {
    super(context, options);
    shapers.push(this);
  }
};

// Chromium's file-fed fake microphone cannot read its file from inside the sandboxed audio
// service, so tests that need a known voice swap in a synthetic one: a looping buffer played
// into a MediaStream by a separate (untracked) AudioContext. The engine still opens it through
// getUserMedia and a MediaStreamAudioSourceNode, exactly like a real microphone.
let syntheticVoice: AudioBuffer | null = null;
let voiceContext: AudioContext | null = null;
const voiceSources: { source: AudioBufferSourceNode; track: MediaStreamTrack }[] = [];

function syntheticMicrophone(voice: AudioBuffer): MediaStream {
  voiceContext ??= new NativeAudioContext({ sampleRate: voice.sampleRate });
  void voiceContext.resume();
  for (const { source, track } of voiceSources) {
    if (track.readyState === 'ended') source.stop();
  }
  const source = new AudioBufferSourceNode(voiceContext, { buffer: voice, loop: true });
  const destination = new MediaStreamAudioDestinationNode(voiceContext, { channelCount: 1 });
  source.connect(destination);
  source.start();
  const track = destination.stream.getAudioTracks()[0];
  if (track !== undefined) voiceSources.push({ source, track });
  return destination.stream;
}

async function useSyntheticMicrophone(wavBase64: string | null): Promise<void> {
  syntheticVoice =
    wavBase64 === null
      ? null
      : await new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytesFromBase64(wavBase64));
}

const streams: MediaStream[] = [];
const requestedConstraints: MediaStreamConstraints[] = [];
const mediaDevices = navigator.mediaDevices;
const nativeGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
mediaDevices.getUserMedia = async (constraints) => {
  if (constraints !== undefined) requestedConstraints.push(constraints);
  const stream =
    syntheticVoice !== null && constraints?.audio
      ? syntheticMicrophone(syntheticVoice)
      : await nativeGetUserMedia(constraints);
  streams.push(stream);
  return stream;
};

const engine = createAudioEngine();
/** The UI polls (and so resets) the peak meters; tests read the latest poll from here. */
let latestMeters: EngineMeters = engine.readMeters();
const errors: AppError[] = [];
const backingEndedAt: number[] = [];
engine.onError((error) => errors.push(error));
engine.onBackingEnded(() => backingEndedAt.push(engine.currentTimeSec));

function liveContext(): AudioContext | null {
  for (let i = contexts.length - 1; i >= 0; i--) {
    const context = contexts[i];
    if (context !== undefined && context.state !== 'closed') return context;
  }
  return null;
}

function contextInfo() {
  const context = liveContext();
  if (context === null) return null;
  return {
    sampleRate: context.sampleRate,
    baseLatencySec: context.baseLatency,
    outputLatencySec: context.outputLatency,
    state: context.state,
  };
}

function microphoneTracks() {
  return streams.flatMap((stream) =>
    stream.getAudioTracks().map((track) => {
      const settings = track.getSettings() as MediaTrackSettings & { latency?: number };
      return {
        readyState: track.readyState,
        latencySec: settings.latency ?? null,
        echoCancellation: settings.echoCancellation ?? null,
        noiseSuppression: settings.noiseSuppression ?? null,
        autoGainControl: settings.autoGainControl ?? null,
        channelCount: settings.channelCount ?? null,
      };
    }),
  );
}

let collected: TakeAudioChunk[] = [];
let stopListening: (() => void) | null = null;

function startCollecting(): void {
  stopListening?.();
  collected = [];
  stopListening = engine.onStemChunk((chunk) => collected.push(chunk));
}

function stopCollecting() {
  stopListening?.();
  stopListening = null;
  return {
    chunks: collected.length,
    chunkFrames: collected.map((chunk) => chunk.vocal.byteLength / STEM_BYTES_PER_FRAME),
    mismatchedChunks: collected.filter(
      (chunk) => chunk.vocal.byteLength !== chunk.backing.byteLength,
    ).length,
    frames: collected.reduce(
      (sum, chunk) => sum + chunk.vocal.byteLength / STEM_BYTES_PER_FRAME,
      0,
    ),
  };
}

/** One channel of a collected stem as base64 little-endian Float32 (compact over CDP). */
function stemBase64(stem: 'vocal' | 'backing', channel: number, from = 0, to?: number): string {
  const frames =
    collected.reduce((sum, chunk) => sum + chunk[stem].byteLength, 0) / STEM_BYTES_PER_FRAME;
  const end = Math.min(to ?? frames, frames);
  const mono = new Float32Array(Math.max(0, end - from));
  let chunkStart = 0;
  for (const chunk of collected) {
    const samples = new Float32Array(chunk[stem]);
    const chunkFrames = samples.length / STEM_CHANNELS;
    for (let n = Math.max(from, chunkStart); n < Math.min(end, chunkStart + chunkFrames); n++) {
      mono[n - from] = samples[(n - chunkStart) * STEM_CHANNELS + channel] ?? 0;
    }
    chunkStart += chunkFrames;
  }
  const bytes = new Uint8Array(mono.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function bytesFromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** A mono backing buffer of unit impulses, so their positions in the stem can be found exactly. */
function setClickBacking(options: {
  durationSec: number;
  intervalSec: number;
  firstClickFrame: number;
}): number[] {
  const sampleRate = engine.sampleRate;
  const length = Math.round(options.durationSec * sampleRate);
  const buffer = new AudioBuffer({ length, sampleRate, numberOfChannels: 1 });
  const data = buffer.getChannelData(0);
  const clickFrames: number[] = [];
  const interval = Math.round(options.intervalSec * sampleRate);
  for (let frame = options.firstClickFrame; frame < length; frame += interval) {
    data[frame] = 1;
    clickFrames.push(frame);
  }
  engine.setBackingTrack(buffer);
  return clickFrames;
}

async function decodeBase64(base64: string) {
  const bytes = bytesFromBase64(base64);
  const byteLengthBefore = bytes.byteLength;
  const result = await engine.decodeAudioFile(bytes);
  return {
    ok: result.ok,
    code: result.ok ? null : result.error.code,
    durationSec: result.ok ? result.value.duration : null,
    sampleRate: result.ok ? result.value.sampleRate : null,
    channels: result.ok ? result.value.numberOfChannels : null,
    callerBytesIntact: bytes.byteLength === byteLengthBefore,
  };
}

async function waitUntilContextTime(timeSec: number): Promise<void> {
  while (engine.isRunning && engine.currentTimeSec < timeSec) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Peak level of everything the singer hears (the soft clipper's output) over a while. */
async function monitorPeak(durationMs: number): Promise<number> {
  const context = liveContext();
  const shaper = shapers.at(-1);
  if (context === null || shaper === undefined || shaper.context !== context) return Number.NaN;
  const analyser = new AnalyserNode(context, { fftSize: 2048 });
  shaper.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let peak = 0;
  const until = performance.now() + durationMs;
  while (performance.now() < until) {
    analyser.getFloatTimeDomainData(samples);
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  shaper.disconnect(analyser);
  return peak;
}

const probe = {
  engine,
  errors,
  backingEndedAt,
  latestMeters: () => latestMeters,
  contextInfo,
  useSyntheticMicrophone,
  requestedConstraints: () => requestedConstraints,
  openContexts: () => contexts.filter((context) => context.state !== 'closed').length,
  microphoneTracks,
  startCollecting,
  stopCollecting,
  stemBase64,
  setClickBacking,
  decodeBase64,
  waitUntilContextTime,
  monitorPeak,
};

declare global {
  interface Window {
    __engineProbe: typeof probe;
  }
}
window.__engineProbe = probe;

function toDb(level: number): string {
  return level > 0 ? `${(20 * Math.log10(level)).toFixed(1)} dBFS` : '-inf';
}

function renderUi(root: HTMLElement): void {
  const startButton = document.createElement('button');
  startButton.textContent = 'Start';
  startButton.addEventListener('click', () => {
    void engine.start({ microphoneId: null, outputId: null }).then((result) => {
      if (!result.ok) errors.push(result.error);
    });
  });
  const stopButton = document.createElement('button');
  stopButton.textContent = 'Stop';
  stopButton.addEventListener('click', () => void engine.stop());
  const chimeButton = document.createElement('button');
  chimeButton.textContent = 'Test sound';
  chimeButton.addEventListener('click', () => void engine.playTestSound());
  const readout = document.createElement('pre');
  readout.className = 'readout';
  root.replaceChildren(startButton, stopButton, chimeButton, readout);

  setInterval(() => {
    const meters = engine.readMeters();
    latestMeters = meters;
    const latency = engine.getLatency();
    const info = contextInfo();
    const ms = (sec: number) => `${(sec * 1000).toFixed(1)} ms`;
    readout.textContent = [
      `running        ${engine.isRunning}  (${engine.sampleRate} Hz)`,
      `base latency   ${info ? ms(info.baseLatencySec) : '-'}`,
      `output latency ${info ? ms(info.outputLatencySec) : '-'}`,
      `input          ${ms(latency.inputSec)}`,
      `processing     ${ms(latency.processingSec)}`,
      `monitoring     ${ms(computeMonitoringLatencySec(latency))}`,
      `input level    ${toDb(meters.inputLevel)}`,
      `output level   ${toDb(meters.outputLevel)}`,
      `pitch          ${meters.detectedMidi?.toFixed(2) ?? '-'} -> ${meters.targetMidi?.toFixed(2) ?? '-'} (${meters.correctionCents.toFixed(0)} c)`,
      `song position  ${engine.getSongPositionSec()?.toFixed(3) ?? '-'}`,
      `errors         ${errors.map((error) => error.code).join(', ') || 'none'}`,
    ].join('\n');
  }, 100);
}

const root = document.getElementById('root');
if (root) renderUi(root);
