// UI-thread side of the stem recorder: sends frame-stamped commands to the worklet, hands its
// chunks to the listeners, and knows when a take has been delivered completely.
import { createAppError } from '@shared/errors';
import { STEM_BYTES_PER_FRAME, type TakeAudioChunk } from '@shared/take';
import type { CaptureFinished, CaptureStarted } from './engineTypes';
import type { RecorderEvent, RecorderRequest } from './protocol';
import type { CaptureCommand } from './stemCapture';
import { frameToTime } from './timing';

/**
 * How long stop() waits for the recorder to confirm. The recorder answers a stop at once,
 * so this only matters when the audio thread is gone; the take then ends with what arrived.
 */
const STOP_TIMEOUT_MS = 2000;

/** The part of a MessagePort this class uses; lets tests stand in for the worklet. */
export interface RecorderPort {
  postMessage(message: RecorderRequest): void;
  onmessage: ((event: MessageEvent<RecorderEvent>) => void) | null;
}

type Phase = 'idle' | 'capturing' | 'paused' | 'stopping';

export class CaptureClient {
  private phase: Phase = 'idle';
  private nextRequestId = 1;
  private readonly pendingReplies = new Map<number, (frame: number | null) => void>();
  private deliveredFrames = 0;
  private stopping: Promise<CaptureFinished> | null = null;
  private finishStop: ((frames: number) => void) | null = null;

  constructor(
    private readonly port: RecorderPort,
    private readonly sampleRate: number,
    private readonly deliverChunk: (chunk: TakeAudioChunk) => void,
  ) {
    port.onmessage = (event) => {
      this.handleEvent(event.data);
    };
  }

  /** True from start() until the take has been delivered completely. */
  get isActive(): boolean {
    return this.phase !== 'idle';
  }

  /** Rejects with a 'recording-failed' AppError when a take is already in progress. */
  async start(frame: number): Promise<CaptureStarted> {
    if (this.phase !== 'idle') {
      throw createAppError('recording-failed', 'A capture is already in progress');
    }
    this.phase = 'capturing';
    this.deliveredFrames = 0;
    const startFrame = await this.send('start', frame);
    if (startFrame === null) {
      this.phase = 'idle';
      throw createAppError('recording-failed', 'The stem recorder did not accept the start');
    }
    return { startContextTimeSec: frameToTime(startFrame, this.sampleRate) };
  }

  /** Does nothing unless a take is being captured. */
  async pause(frame: number): Promise<void> {
    if (this.phase !== 'capturing') return;
    this.phase = 'paused';
    await this.send('pause', frame);
  }

  /** Does nothing unless the take is paused. */
  async resume(frame: number): Promise<void> {
    if (this.phase !== 'paused') return;
    this.phase = 'capturing';
    await this.send('resume', frame);
  }

  /** Ends the take as soon as possible; resolves once its last chunk has been delivered. */
  stop(): Promise<CaptureFinished> {
    if (this.stopping !== null) return this.stopping;
    if (this.phase === 'idle') return Promise.resolve({ frames: 0 });

    this.phase = 'stopping';
    this.stopping = new Promise<CaptureFinished>((resolve) => {
      const timeout = setTimeout(() => this.finishStop?.(this.deliveredFrames), STOP_TIMEOUT_MS);
      this.finishStop = (frames) => {
        clearTimeout(timeout);
        this.finishStop = null;
        this.stopping = null;
        this.phase = 'idle';
        resolve({ frames });
      };
    });
    void this.send('stop', 0);
    return this.stopping;
  }

  /** Detaches from the worklet. Anything still waiting settles with what is known so far. */
  dispose(): void {
    this.port.onmessage = null;
    for (const settle of this.pendingReplies.values()) settle(null);
    this.pendingReplies.clear();
    this.finishStop?.(this.deliveredFrames);
    this.phase = 'idle';
  }

  /** Resolves with the frame the command really takes effect on (null = refused or gone). */
  private send(command: CaptureCommand, frame: number): Promise<number | null> {
    const id = this.nextRequestId++;
    return new Promise<number | null>((resolve) => {
      this.pendingReplies.set(id, resolve);
      this.port.postMessage({ id, command, frame });
    });
  }

  private handleEvent(event: RecorderEvent): void {
    switch (event.type) {
      case 'scheduled': {
        const settle = this.pendingReplies.get(event.id);
        this.pendingReplies.delete(event.id);
        settle?.(event.frame);
        return;
      }
      case 'chunk':
        this.deliveredFrames += event.vocal.byteLength / STEM_BYTES_PER_FRAME;
        this.deliverChunk({ vocal: event.vocal, backing: event.backing });
        return;
      case 'stopped':
        // Chunks and this message travel on the same port in order, so by now every
        // chunk of the take has been delivered.
        this.finishStop?.(event.frames);
        return;
    }
  }
}
