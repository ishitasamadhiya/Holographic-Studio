import { STEM_BYTES_PER_FRAME } from '@shared/take';
import { SerialQueue } from '../util/serialQueue';

/** Where recorded bytes go. A node:fs FileHandle fits. */
export interface ByteSink {
  appendFile(data: Uint8Array): Promise<unknown>;
  close(): Promise<void>;
}

export interface RecordingSinks {
  vocal: ByteSink;
  backing: ByteSink;
  /** Null for an audio-only take. */
  video: ByteSink | null;
}

export interface RecordedSizes {
  vocalBytes: number;
  backingBytes: number;
  videoBytes: number;
}

/**
 * Writes one take's incoming chunks to its files. Chunks arrive fire-and-forget, so all
 * writes go through a single queue (they land in exactly the order they were sent, and the
 * two stems advance in lockstep) and the first failure is remembered: later chunks are
 * dropped and close() reports what went wrong.
 */
export class TakeRecording {
  private readonly queue = new SerialQueue();
  private readonly sizes: RecordedSizes = { vocalBytes: 0, backingBytes: 0, videoBytes: 0 };
  private failure: Error | null = null;
  private closing: Promise<RecordedSizes> | null = null;

  constructor(private readonly sinks: RecordingSinks) {}

  appendAudio(vocal: Uint8Array, backing: Uint8Array): void {
    if (this.closing || this.failure) return;
    if (vocal.byteLength === 0 && backing.byteLength === 0) return;
    this.enqueue(async () => {
      if (vocal.byteLength !== backing.byteLength) {
        throw new Error(
          `Vocal and backing chunks differ in length (${vocal.byteLength} vs ${backing.byteLength} bytes)`,
        );
      }
      if (vocal.byteLength % STEM_BYTES_PER_FRAME !== 0) {
        throw new Error(`Audio chunk of ${vocal.byteLength} bytes is not a whole number of frames`);
      }
      await this.sinks.vocal.appendFile(vocal);
      this.sizes.vocalBytes += vocal.byteLength;
      await this.sinks.backing.appendFile(backing);
      this.sizes.backingBytes += backing.byteLength;
    });
  }

  appendVideo(chunk: Uint8Array): void {
    const video = this.sinks.video;
    if (this.closing || this.failure || !video || chunk.byteLength === 0) return;
    this.enqueue(async () => {
      await video.appendFile(chunk);
      this.sizes.videoBytes += chunk.byteLength;
    });
  }

  /**
   * Waits for every queued write and closes the files. Rejects with the first error that
   * happened while recording. Safe to call more than once.
   */
  close(): Promise<RecordedSizes> {
    this.closing ??= this.flushAndClose();
    return this.closing;
  }

  /** Queues one write. Once a write has failed, everything behind it is skipped. */
  private enqueue(write: () => Promise<void>): void {
    void this.queue.run(async () => {
      if (this.failure) return;
      try {
        await write();
      } catch (error) {
        this.fail(error);
      }
    });
  }

  /** Marks the take as broken (e.g. a chunk was lost on the way); close() will report it. */
  fail(error: unknown): void {
    this.failure ??= error instanceof Error ? error : new Error(String(error));
  }

  private async flushAndClose(): Promise<RecordedSizes> {
    await this.queue.idle();
    const sinks = [this.sinks.vocal, this.sinks.backing, this.sinks.video];
    for (const sink of sinks) {
      // A failed close can mean lost data, so it counts as a recording failure too.
      await sink?.close().catch((error: unknown) => this.fail(error));
    }
    if (this.failure) throw this.failure;
    return { ...this.sizes };
  }
}
