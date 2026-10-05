import { describe, expect, it } from 'vitest';
import { FakeClock, flushPromises } from './testing/fakeClock';
import {
  createVideoRecorderFactory,
  type MediaRecorderConstructor,
  type MediaRecorderLike,
} from './videoRecorder';

/** A MediaRecorder stand-in whose events the test fires by hand. */
class ScriptedRecorder implements MediaRecorderLike {
  static instances: ScriptedRecorder[] = [];
  static isTypeSupported = (mimeType: string): boolean => mimeType.includes('avc1');
  state: RecordingState = 'inactive';
  timeslice: number | undefined;
  ondataavailable: MediaRecorder['ondataavailable'] = null;
  onstart: MediaRecorder['onstart'] = null;
  onstop: MediaRecorder['onstop'] = null;
  onerror: MediaRecorder['onerror'] = null;

  constructor(
    readonly stream: MediaStream,
    readonly options: MediaRecorderOptions,
  ) {
    ScriptedRecorder.instances.push(this);
  }

  start(timeslice?: number): void {
    this.state = 'recording';
    this.timeslice = timeslice;
  }

  pause(): void {
    this.state = 'paused';
  }

  resume(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
  }

  fire(name: 'onstart' | 'onstop'): void {
    this[name]?.call(this as unknown as MediaRecorder, new Event(name.slice(2)));
  }

  /** Delivers a chunk whose bytes take `readDelayMs` of real time to read. */
  deliver(firstByte: number, readDelayMs = 0): void {
    const data = {
      size: 4,
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((resolve) => {
          setTimeout(() => resolve(new Uint8Array([firstByte, 0, 0, 0]).buffer), readDelayMs);
        }),
    };
    this.ondataavailable?.call(this as unknown as MediaRecorder, { data } as BlobEvent);
  }
}

function setup() {
  ScriptedRecorder.instances = [];
  const clock = new FakeClock();
  const stoppedTracks: string[] = [];
  const factory = createVideoRecorderFactory(clock, {
    Recorder: ScriptedRecorder as unknown as MediaRecorderConstructor,
    videoOnlyCopy: () =>
      ({
        getTracks: () => [{ stop: () => stoppedTracks.push('copy') }],
      }) as unknown as MediaStream,
  });
  const chunks: number[] = [];
  const errors: unknown[] = [];
  const recorder = factory.create({} as MediaStream, {
    mimeType: 'video/x-matroska;codecs=avc1',
    videoBitsPerSecond: 16_000_000,
    onChunk: (chunk) => chunks.push(new Uint8Array(chunk)[0] ?? -1),
    onError: (error) => errors.push(error),
  });
  const native = (): ScriptedRecorder => {
    const instance = ScriptedRecorder.instances[0];
    if (!instance) throw new Error('No recorder');
    return instance;
  };
  return { clock, factory, recorder, native, chunks, errors, stoppedTracks };
}

describe('the MediaRecorder adapter', () => {
  it('records a video-only copy with the requested type, bitrate and a one-second timeslice', async () => {
    const h = setup();
    const started = h.recorder.start();
    expect(h.native().options).toEqual({
      mimeType: 'video/x-matroska;codecs=avc1',
      videoBitsPerSecond: 16_000_000,
    });
    expect(h.native().timeslice).toBe(1000);
    const startedAt = h.clock.nowMs();
    await h.clock.advance(120);
    h.native().fire('onstart');
    // The timeline starts at the start() call, not at the later "start" event.
    await expect(started).resolves.toBe(startedAt);
    expect(h.factory.isTypeSupported('video/webm;codecs=vp8')).toBe(false);
  });

  it('delivers chunks in recording order even when later ones are read faster', async () => {
    const h = setup();
    const started = h.recorder.start();
    h.native().fire('onstart');
    await started;
    h.native().deliver(1, 30);
    h.native().deliver(2, 0);
    h.native().deliver(3, 10);
    const stopping = h.recorder.stop();
    h.native().fire('onstop');
    await stopping;
    expect(h.chunks).toEqual([1, 2, 3]);
    expect(h.stoppedTracks).toEqual(['copy']);
  });

  it('stop waits for the final chunk that arrives with the stop event', async () => {
    const h = setup();
    const started = h.recorder.start();
    h.native().fire('onstart');
    await started;
    let stopped = false;
    const stopping = h.recorder.stop().then(() => {
      stopped = true;
    });
    await flushPromises();
    expect(stopped).toBe(false);
    h.native().deliver(9, 5);
    h.native().fire('onstop');
    await stopping;
    expect(h.chunks).toEqual([9]);
  });

  it('rejects a start that never gets going', async () => {
    const h = setup();
    const started = h.recorder.start();
    const outcome = started.catch((error: unknown) => error);
    await h.clock.advance(3000);
    expect(await outcome).toBeInstanceOf(Error);
  });

  it('pauses and resumes only from the matching state', async () => {
    const h = setup();
    h.recorder.pause();
    expect(h.native().state).toBe('inactive');
    const started = h.recorder.start();
    h.native().fire('onstart');
    await started;
    h.recorder.pause();
    expect(h.native().state).toBe('paused');
    h.recorder.resume();
    expect(h.native().state).toBe('recording');
  });
});
