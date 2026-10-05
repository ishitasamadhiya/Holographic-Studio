// The Web Audio implementation of the AudioEngine facade (see engineTypes.ts for the contract
// and docs/ARCHITECTURE.md §4 for the graph).
import { DEFAULT_VOCAL_CHAIN_CONTROLS } from '@dsp/vocalChain';
import { CONTROL_IDS, type ControlValues } from '@shared/controls';
import { createAppError, fail, ok, type AppError, type Result } from '@shared/errors';
import type { Unsubscribe } from '@shared/ipc';
import type { PitchTargetData } from '@shared/music';
import type { TakeAudioChunk } from '@shared/take';
import { OutputClock, type LatencyBreakdown } from '@renderer/recording/syncTimeline';
import { BackingPlayer } from './backingPlayer';
import { CaptureClient, type RecorderPort } from './captureClient';
import { decodeAudioFile } from './decodeAudio';
import { ENGINE_SAMPLE_RATE, OUTPUT_CLOCK_SAMPLE_INTERVAL_MS } from './engineConstants';
import { buildEngineGraph, rampGain, type EngineGraph } from './engineGraph';
import type {
  AudioEngine,
  BackingStartOptions,
  CaptureFinished,
  CaptureStarted,
  EngineMeters,
  EngineStartOptions,
  MixSettings,
} from './engineTypes';
import { describeLatency, outputClockReading } from './latency';
import { ListenerSet } from './listenerSet';
import { MeterAccumulator } from './meterAccumulator';
import { microphoneLatencySec, openMicrophone } from './microphone';
import { backingGain, DEFAULT_MIX, mergeMix, monitorGain } from './mixLevels';
import {
  openLowLatencyContext,
  routeOutput,
  supportsOutputSelection,
  type LatencyHint,
} from './outputDevice';
import type { VocalChainEvent, VocalChainRequest } from './protocol';
import type { SongClockState } from './songClock';
import { heardSongPosition } from './songClock';
import { CHIME_MAX_SEC, playChime } from './testSound';
import { resolveScheduleFrame, schedulingLeadSec } from './timing';
import { loadWorkletModules } from './workletModules';

/** The song clock is re-sent to the vocal chain when the round-trip latency moves this much. */
const LATENCY_UPDATE_THRESHOLD_SEC = 0.0005;

const PROCESSOR_FAILED_MESSAGE = 'The live sound stopped unexpectedly. Try again to restart it.';
const INTERRUPTED_MESSAGE = 'The system interrupted the sound.';

/** Everything that exists only while the engine runs. */
interface Session {
  context: AudioContext;
  graph: EngineGraph;
  stream: MediaStream;
  microphone: MediaStreamAudioSourceNode;
  player: BackingPlayer;
  capture: CaptureClient;
  /** VocalChain.latencySamples, as reported by the worklet. */
  processingLatencyFrames: number;
  /** Round-trip latency the vocal chain last received with the song clock. */
  sentRoundTripSec: number;
  clockTimer: ReturnType<typeof setInterval>;
  /** The first thing that broke live audio in this session (AudioEngine.fault). */
  fault: AppError | null;
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** An 'audio-engine-failed' error for something that went wrong after the engine started. */
function runtimeFailure(message: string, detail: string): AppError {
  return { ...createAppError('audio-engine-failed', detail), message };
}

function withTimeout(task: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, timeoutMs);
    task.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

class WebAudioEngine implements AudioEngine {
  private session: Session | null = null;
  /** start / stop / device switches run one at a time, in call order. */
  private operations: Promise<unknown> = Promise.resolve();

  private mix: MixSettings = { ...DEFAULT_MIX };
  private controls: ControlValues = {
    autotune: DEFAULT_VOCAL_CHAIN_CONTROLS.autotune,
    echo: DEFAULT_VOCAL_CHAIN_CONTROLS.echo,
    volume: DEFAULT_VOCAL_CHAIN_CONTROLS.volume,
  };
  private pitchTargets: PitchTargetData | null = null;
  private backingBuffer: AudioBuffer | null = null;
  private outputId: string | null = null;
  /** The latency hint that gave the smallest output buffer on this machine (found once). */
  private latencyHint: LatencyHint | undefined;
  private lastLatency: LatencyBreakdown = { inputSec: 0, outputSec: 0, processingSec: 0 };

  private readonly clock = new OutputClock();
  private readonly meters = new MeterAccumulator();
  private readonly errorListeners = new ListenerSet<AppError>((error) => {
    console.error('An audio engine error listener failed', error);
  });
  private readonly chunkListeners = new ListenerSet<TakeAudioChunk>((error) => {
    this.reportError(createAppError('recording-failed', error));
  });
  private readonly backingEndedListeners = new ListenerSet<void>((error) => {
    this.reportError(createAppError('unknown', error));
  });

  get isRunning(): boolean {
    return this.session !== null;
  }

  get fault(): AppError | null {
    return this.session?.fault ?? null;
  }

  get sampleRate(): number {
    return this.session?.context.sampleRate ?? ENGINE_SAMPLE_RATE;
  }

  get outputSelectionSupported(): boolean {
    return supportsOutputSelection();
  }

  get hasBackingTrack(): boolean {
    return this.backingBuffer !== null;
  }

  get currentTimeSec(): number {
    return this.session?.context.currentTime ?? 0;
  }

  get isBackingPlaying(): boolean {
    return this.session?.player.isPlaying ?? false;
  }

  start(options: EngineStartOptions): Promise<Result<void>> {
    return this.serialize(() => this.startNow(options));
  }

  stop(): Promise<void> {
    return this.serialize(() => this.stopNow());
  }

  setMicrophone(deviceId: string | null): Promise<Result<void>> {
    return this.serialize(() => this.switchMicrophone(deviceId));
  }

  setOutput(deviceId: string | null): Promise<Result<void>> {
    return this.serialize(async () => {
      this.outputId = deviceId;
      const session = this.session;
      if (session === null) return ok(undefined);
      if (!(await routeOutput(session.context, deviceId))) {
        return fail('audio-engine-failed', 'The output device could not be selected');
      }
      // A different device has a different delay to the ears.
      this.clock.reset();
      this.sampleOutputClock(session);
      return ok(undefined);
    });
  }

  setMix(patch: Partial<MixSettings>): void {
    const previous = this.mix;
    this.mix = mergeMix(previous, patch);
    const session = this.session;
    if (session === null) return;
    const { context, graph } = session;
    rampGain(graph.monitor.gain, monitorGain(this.mix), context);
    rampGain(graph.backing.gain, backingGain(this.mix), context);
    if (
      this.mix.micGain !== previous.micGain ||
      this.mix.reverbEnabled !== previous.reverbEnabled
    ) {
      this.postMix(session);
    }
  }

  setControls(values: ControlValues): void {
    const session = this.session;
    for (const id of CONTROL_IDS) {
      const value = values[id];
      if (!Number.isFinite(value) || value === this.controls[id]) continue;
      const clamped = Math.min(1, Math.max(0, value));
      this.controls[id] = clamped;
      const param = session?.graph.vocal.parameters.get(id);
      if (param !== undefined) param.value = clamped;
    }
  }

  setPitchTargets(targets: PitchTargetData | null): void {
    this.pitchTargets = targets;
    if (this.session !== null) this.postToVocal(this.session, { type: 'pitch-targets', targets });
  }

  decodeAudioFile(bytes: ArrayBuffer): Promise<Result<AudioBuffer>> {
    return decodeAudioFile(bytes, this.sampleRate);
  }

  setBackingTrack(buffer: AudioBuffer | null): void {
    this.backingBuffer = buffer;
    this.session?.player.setBuffer(buffer);
  }

  startBacking(options: BackingStartOptions = {}): number {
    const session = this.session;
    if (session === null) return 0;
    const frame = this.scheduleFrame(session, options.atContextTimeSec);
    return session.player.start(frame, options.offsetSec ?? 0);
  }

  stopBacking(atContextTimeSec?: number): number {
    const session = this.session;
    if (session === null) return 0;
    return session.player.stop(this.scheduleFrame(session, atContextTimeSec));
  }

  getSongPositionSec(): number | null {
    const session = this.session;
    const clock = session?.player.clock ?? null;
    if (session === null || clock === null) return null;
    const { context } = session;
    return heardSongPosition(
      clock,
      context.currentTime,
      context.sampleRate,
      this.getLatency().outputSec,
    );
  }

  onBackingEnded(listener: () => void): Unsubscribe {
    return this.backingEndedListeners.add(listener);
  }

  async startCapture(atContextTimeSec?: number): Promise<CaptureStarted> {
    const session = this.session;
    if (session === null) {
      throw createAppError('audio-engine-failed', 'Capture requested while the engine is stopped');
    }
    return session.capture.start(this.scheduleFrame(session, atContextTimeSec));
  }

  async pauseCapture(atContextTimeSec?: number): Promise<void> {
    const session = this.session;
    if (session !== null)
      await session.capture.pause(this.scheduleFrame(session, atContextTimeSec));
  }

  async resumeCapture(atContextTimeSec?: number): Promise<void> {
    const session = this.session;
    if (session !== null) {
      await session.capture.resume(this.scheduleFrame(session, atContextTimeSec));
    }
  }

  stopCapture(): Promise<CaptureFinished> {
    return this.session?.capture.stop() ?? Promise.resolve({ frames: 0 });
  }

  onStemChunk(listener: (chunk: TakeAudioChunk) => void): Unsubscribe {
    return this.chunkListeners.add(listener);
  }

  getLatency(): LatencyBreakdown {
    const session = this.session;
    if (session === null) return { ...this.lastLatency };
    const { context } = session;
    const track = session.stream.getAudioTracks()[0];
    this.lastLatency = describeLatency({
      microphoneLatencySec: microphoneLatencySec(track?.getSettings()),
      baseLatencySec: context.baseLatency,
      deviceOutputLatencySec: context.outputLatency,
      processingLatencyFrames: session.processingLatencyFrames,
      sampleRate: context.sampleRate,
    });
    return { ...this.lastLatency };
  }

  getOutputClock(): OutputClock {
    return this.clock;
  }

  readMeters(): EngineMeters {
    return this.meters.read();
  }

  async playTestSound(): Promise<void> {
    const timeoutMs = (CHIME_MAX_SEC + 0.5) * 1000;
    try {
      const session = this.session;
      if (session !== null) {
        // Straight into the master: heard, but never part of either recorded stem.
        await withTimeout(playChime(session.context, session.graph.master), timeoutMs);
        return;
      }
      const context = new AudioContext({ sampleRate: ENGINE_SAMPLE_RATE });
      try {
        await routeOutput(context, this.outputId);
        await context.resume();
        await withTimeout(playChime(context, context.destination), timeoutMs);
      } finally {
        await context.close();
      }
    } catch (error) {
      this.reportError(createAppError('audio-engine-failed', error));
    }
  }

  onError(listener: (error: AppError) => void): Unsubscribe {
    return this.errorListeners.add(listener);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation, operation);
    this.operations = result.catch(() => undefined);
    return result;
  }

  private async startNow(options: EngineStartOptions): Promise<Result<void>> {
    await this.stopNow();
    this.outputId = options.outputId;

    const microphone = await openMicrophone(navigator.mediaDevices, options.microphoneId);
    if (!microphone.ok) return microphone;
    const stream = microphone.value;

    let context: AudioContext | null = null;
    try {
      const opened = await openLowLatencyContext(options.outputId, this.latencyHint);
      this.latencyHint = opened.latencyHint;
      context = opened.context;
      await loadWorkletModules(context);
      const session = this.createSession(context, stream);
      this.session = session;
      await context.resume();
      this.sampleOutputClock(session);
      return ok(undefined);
    } catch (error) {
      if (this.session !== null) {
        await this.stopNow();
      } else {
        stopTracks(stream);
        await context?.close().catch(() => undefined);
      }
      return fail('audio-engine-failed', error);
    }
  }

  private createSession(context: AudioContext, stream: MediaStream): Session {
    const graph = buildEngineGraph(context, this.mix, this.controls);
    const microphone = context.createMediaStreamSource(stream);
    microphone.connect(graph.vocal);

    const player = new BackingPlayer(context, graph.backing, {
      onClockChanged: (clock) => {
        this.postSongClock(session, clock);
      },
      onEnded: () => {
        this.backingEndedListeners.emit();
      },
    });
    const capture = new CaptureClient(
      graph.recorder.port as RecorderPort,
      context.sampleRate,
      (chunk) => {
        this.chunkListeners.emit(chunk);
      },
    );

    const session: Session = {
      context,
      graph,
      stream,
      microphone,
      player,
      capture,
      processingLatencyFrames: 0,
      sentRoundTripSec: 0,
      clockTimer: setInterval(() => {
        this.sampleOutputClock(session);
      }, OUTPUT_CLOCK_SAMPLE_INTERVAL_MS),
      fault: null,
    };

    graph.vocal.port.onmessage = (event: MessageEvent<VocalChainEvent>) => {
      const message = event.data;
      if (message.type === 'meters') this.meters.add(message);
      else session.processingLatencyFrames = message.latencySamples;
    };
    this.watchMicrophone(session, stream);
    context.onstatechange = () => {
      this.handleContextState(session);
    };
    // A processor whose process() throws outputs silence for the rest of its life. Listeners
    // rather than onprocessorerror, which Chromium skipped for a dispatched event in testing;
    // they need no removal, since setFault ignores a session that has ended.
    graph.vocal.addEventListener('processorerror', () => {
      this.setFault(session, runtimeFailure(PROCESSOR_FAILED_MESSAGE, 'The vocal chain failed'));
    });
    graph.recorder.addEventListener('processorerror', () => {
      this.setFault(session, runtimeFailure(PROCESSOR_FAILED_MESSAGE, 'The stem recorder failed'));
    });

    this.clock.reset();
    this.meters.reset();
    this.postMix(session);
    if (this.pitchTargets !== null) {
      this.postToVocal(session, { type: 'pitch-targets', targets: this.pitchTargets });
    }
    player.setBuffer(this.backingBuffer);
    return session;
  }

  private async stopNow(): Promise<void> {
    const session = this.session;
    if (session === null) return;
    this.getLatency();
    this.session = null;

    clearInterval(session.clockTimer);
    session.context.onstatechange = null;
    session.capture.dispose();
    session.player.dispose();
    session.graph.vocal.port.onmessage = null;
    stopTracks(session.stream);
    session.microphone.disconnect();
    session.graph.disconnect();
    this.meters.reset();
    this.clock.reset();
    await session.context.close().catch(() => undefined);
  }

  /** Swaps the microphone in place: the graph, the backing and any capture keep running. */
  private async switchMicrophone(deviceId: string | null): Promise<Result<void>> {
    const session = this.session;
    if (session === null) return ok(undefined);

    const opened = await openMicrophone(navigator.mediaDevices, deviceId);
    if (!opened.ok) return opened;
    const microphone = session.context.createMediaStreamSource(opened.value);
    microphone.connect(session.graph.vocal);
    session.microphone.disconnect();
    stopTracks(session.stream);
    session.microphone = microphone;
    session.stream = opened.value;
    this.watchMicrophone(session, opened.value);
    return ok(undefined);
  }

  private watchMicrophone(session: Session, stream: MediaStream): void {
    for (const track of stream.getAudioTracks()) {
      // Fires when the device goes away, never for our own track.stop().
      track.addEventListener('ended', () => {
        if (session.stream === stream) {
          this.setFault(
            session,
            createAppError('device-disconnected', 'The microphone track ended'),
          );
        }
      });
    }
  }

  /** Records what broke live audio (the first fault stands) and reports it once. */
  private setFault(session: Session, fault: AppError): void {
    if (this.session !== session || session.fault !== null) return;
    session.fault = fault;
    // The meters would otherwise keep showing the last level a dead vocal chain reported.
    this.meters.reset();
    this.reportError(fault);
  }

  private handleContextState(session: Session): void {
    if (this.session !== session) return;
    const state: string = session.context.state;
    if (state === 'suspended' || state === 'interrupted') {
      if (session.capture.isActive) {
        // The audio clock stands still, so the stems get nothing while the camera keeps
        // recording: no later sync estimate can line the two up across the gap.
        this.reportError(runtimeFailure(INTERRUPTED_MESSAGE, `The audio context was ${state}`));
      }
      // The system took the audio device away (another app, sleep, a route change): ask for it back.
      session.context.resume().catch((error: unknown) => {
        this.reportError(createAppError('audio-engine-failed', error));
      });
    } else if (state === 'closed') {
      this.reportError(createAppError('audio-engine-failed', 'The audio context closed'));
    }
  }

  private scheduleFrame(session: Session, atContextTimeSec: number | undefined): number {
    const { context } = session;
    return resolveScheduleFrame(
      atContextTimeSec,
      context.currentTime,
      schedulingLeadSec(context.baseLatency, context.sampleRate),
      context.sampleRate,
    );
  }

  private sampleOutputClock(session: Session): void {
    if (this.session !== session || session.context.state !== 'running') return;
    const { context } = session;
    const latency = this.getLatency();
    this.clock.addSample(
      outputClockReading(
        context.getOutputTimestamp(),
        context.currentTime,
        performance.now(),
        latency.outputSec,
      ),
    );
    const roundTripSec = latency.inputSec + latency.outputSec;
    if (Math.abs(roundTripSec - session.sentRoundTripSec) > LATENCY_UPDATE_THRESHOLD_SEC) {
      this.postSongClock(session, session.player.clock);
    }
  }

  private postSongClock(session: Session, clock: SongClockState | null): void {
    const latency = this.session === session ? this.getLatency() : this.lastLatency;
    session.sentRoundTripSec = latency.inputSec + latency.outputSec;
    this.postToVocal(session, {
      type: 'song-clock',
      clock: clock === null ? null : { ...clock },
      roundTripLatencySec: session.sentRoundTripSec,
    });
  }

  private postMix(session: Session): void {
    this.postToVocal(session, {
      type: 'mix',
      micGain: this.mix.micGain,
      reverbEnabled: this.mix.reverbEnabled,
    });
  }

  private postToVocal(session: Session, request: VocalChainRequest): void {
    session.graph.vocal.port.postMessage(request);
  }

  private reportError(error: AppError): void {
    this.errorListeners.emit(error);
  }
}

export function createAudioEngine(): AudioEngine {
  return new WebAudioEngine();
}
