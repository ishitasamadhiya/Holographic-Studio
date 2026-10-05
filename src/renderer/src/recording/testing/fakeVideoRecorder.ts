// A camera recorder for tests: reports what it was asked to do and when, and hands over
// chunks only when the test produces them.
import type { Clock } from '../clock';
import type { VideoRecorder, VideoRecorderFactory, VideoRecorderOptions } from '../videoRecorder';

export class FakeVideoRecorder implements VideoRecorder {
  readonly events: Array<{ name: string; atMs: number }> = [];
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  /** When true, start() waits until the test calls confirmStart(). */
  holdStart = false;
  private confirm: (() => void) | null = null;
  private chunkCount = 0;

  constructor(
    private readonly clock: Clock,
    readonly stream: MediaStream,
    readonly options: VideoRecorderOptions,
  ) {}

  start(): Promise<number> {
    const startedAtMs = this.clock.nowMs();
    this.events.push({ name: 'start', atMs: startedAtMs });
    this.state = 'recording';
    if (!this.holdStart) return Promise.resolve(startedAtMs);
    return new Promise((resolve) => {
      this.confirm = () => resolve(startedAtMs);
    });
  }

  confirmStart(): void {
    this.confirm?.();
  }

  pause(): void {
    this.events.push({ name: 'pause', atMs: this.clock.nowMs() });
    this.state = 'paused';
  }

  resume(): void {
    this.events.push({ name: 'resume', atMs: this.clock.nowMs() });
    this.state = 'recording';
  }

  async stop(): Promise<void> {
    this.events.push({ name: 'stop', atMs: this.clock.nowMs() });
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.emitChunk();
  }

  /** Delivers one recorded chunk whose first byte is its sequence number. */
  emitChunk(): ArrayBuffer {
    this.chunkCount += 1;
    const chunk = new Uint8Array([this.chunkCount, 0, 0, 0]).buffer;
    this.options.onChunk(chunk);
    return chunk;
  }

  /** The encoder gave up mid-take. */
  failMidway(): void {
    this.options.onError(new Error('encoder failed'));
  }
}

export class FakeVideoRecorderFactory implements VideoRecorderFactory {
  readonly created: FakeVideoRecorder[] = [];
  supportedTypes: string[] = ['video/x-matroska;codecs=avc1', 'video/webm;codecs=vp8'];
  holdStart = false;

  constructor(private readonly clock: Clock) {}

  isTypeSupported = (mimeType: string): boolean => this.supportedTypes.includes(mimeType);

  create(stream: MediaStream, options: VideoRecorderOptions): FakeVideoRecorder {
    const recorder = new FakeVideoRecorder(this.clock, stream, options);
    recorder.holdStart = this.holdStart;
    this.created.push(recorder);
    return recorder;
  }

  get latest(): FakeVideoRecorder {
    const recorder = this.created.at(-1);
    if (!recorder) throw new Error('No video recorder was created');
    return recorder;
  }
}
