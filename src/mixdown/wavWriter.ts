import { open, rm, type FileHandle } from 'node:fs/promises';

export interface WavFormat {
  sampleRate: number;
  channels: number;
  frameCount: number;
}

const WAVE_FORMAT_IEEE_FLOAT = 3;
const BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;
/** RIFF header + extended "fmt " chunk + "fact" chunk + "data" chunk header. */
export const FLOAT_WAV_HEADER_BYTES = 58;
const MAX_RIFF_BYTES = 0xffffffff;

/**
 * Header of a 32-bit float WAV file. Non-PCM formats must carry the extended format chunk
 * (with its trailing size field) and a "fact" chunk holding the frame count.
 */
export function buildFloatWavHeader(format: WavFormat): Buffer {
  const blockAlign = format.channels * BYTES_PER_SAMPLE;
  const dataBytes = format.frameCount * blockAlign;
  if (dataBytes + FLOAT_WAV_HEADER_BYTES - 8 > MAX_RIFF_BYTES) {
    throw new RangeError('The audio is too long for a WAV file');
  }

  const header = Buffer.alloc(FLOAT_WAV_HEADER_BYTES);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(FLOAT_WAV_HEADER_BYTES - 8 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');

  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(18, 16);
  header.writeUInt16LE(WAVE_FORMAT_IEEE_FLOAT, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.writeUInt16LE(0, 36);

  header.write('fact', 38, 'ascii');
  header.writeUInt32LE(4, 42);
  header.writeUInt32LE(format.frameCount, 46);

  header.write('data', 50, 'ascii');
  header.writeUInt32LE(dataBytes, 54);
  return header;
}

/** Streams interleaved Float32 audio into a WAV file whose length is known up front. */
export class WavWriter {
  private framesWritten = 0;

  private constructor(
    private readonly handle: FileHandle,
    private readonly path: string,
    private readonly format: WavFormat,
  ) {}

  static async create(path: string, format: WavFormat): Promise<WavWriter> {
    const header = buildFloatWavHeader(format);
    const handle = await open(path, 'w');
    try {
      await handle.appendFile(header);
    } catch (error) {
      await handle.close();
      await rm(path, { force: true });
      throw error;
    }
    return new WavWriter(handle, path, format);
  }

  async write(interleaved: Float32Array, frameCount: number): Promise<void> {
    if (frameCount === 0) return;
    const byteLength = frameCount * this.format.channels * BYTES_PER_SAMPLE;
    // WAV is little-endian, like the Float32Array memory on every platform Electron runs on.
    await this.handle.appendFile(
      Buffer.from(interleaved.buffer, interleaved.byteOffset, byteLength),
    );
    this.framesWritten += frameCount;
  }

  /** Closes the file. Throws if the audio written does not match the header. */
  async close(): Promise<void> {
    await this.handle.close();
    if (this.framesWritten !== this.format.frameCount) {
      await rm(this.path, { force: true });
      throw new Error(
        `WAV file is incomplete: wrote ${this.framesWritten} of ${this.format.frameCount} frames`,
      );
    }
  }

  /** Closes and deletes the unfinished file. */
  async abort(): Promise<void> {
    await this.handle.close().catch(() => undefined);
    await rm(this.path, { force: true });
  }
}
