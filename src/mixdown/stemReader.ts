import { open, type FileHandle } from 'node:fs/promises';
import { STEM_BYTES_PER_FRAME, STEM_CHANNELS } from '@shared/take';

/** Random-access reader for one raw stem file (Float32 LE, interleaved stereo). */
export class StemReader {
  private constructor(
    private readonly handle: FileHandle,
    /** Whole frames available: the smaller of the file's length and the manifest's count. */
    readonly frameCount: number,
  ) {}

  static async open(path: string, maxFrames: number): Promise<StemReader> {
    const handle = await open(path, 'r');
    try {
      const { size } = await handle.stat();
      const framesOnDisk = Math.floor(size / STEM_BYTES_PER_FRAME);
      return new StemReader(handle, Math.max(0, Math.min(maxFrames, framesOnDisk)));
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  /**
   * Copies stem frames [startFrame, startFrame + frameCount) into `target`.
   * Frames before the start or past the end of the stem are silence.
   */
  async read(startFrame: number, frameCount: number, target: Float32Array): Promise<void> {
    target.fill(0, 0, frameCount * STEM_CHANNELS);
    const firstFrame = Math.max(0, startFrame);
    const endFrame = Math.min(this.frameCount, startFrame + frameCount);
    if (endFrame <= firstFrame) return;

    // The file bytes are read straight into the Float32Array's memory. That is only correct
    // on little-endian hosts, which is every platform Electron runs on.
    const bytes = Buffer.from(
      target.buffer,
      target.byteOffset + (firstFrame - startFrame) * STEM_BYTES_PER_FRAME,
      (endFrame - firstFrame) * STEM_BYTES_PER_FRAME,
    );
    const filePosition = firstFrame * STEM_BYTES_PER_FRAME;
    let bytesDone = 0;
    while (bytesDone < bytes.length) {
      const { bytesRead } = await this.handle.read(
        bytes,
        bytesDone,
        bytes.length - bytesDone,
        filePosition + bytesDone,
      );
      if (bytesRead === 0) break;
      bytesDone += bytesRead;
    }
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}
