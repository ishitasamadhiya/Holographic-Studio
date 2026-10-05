import { describe, expect, it } from 'vitest';
import { TakeRecording, type ByteSink } from './takeRecording';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

class MemorySink implements ByteSink {
  readonly writes: number[][] = [];
  closed = false;
  failOnWrite: number | null = null;
  failOnClose = false;

  constructor(
    private readonly log: string[],
    private readonly name: string,
    private readonly delayMs = 0,
  ) {}

  async appendFile(data: Uint8Array): Promise<void> {
    // Later writes are made faster than earlier ones, so only a real queue keeps the order.
    await sleep(Math.max(0, this.delayMs - this.writes.length));
    if (this.failOnWrite === this.writes.length) throw new Error(`${this.name}: disk full`);
    this.writes.push([...data]);
    this.log.push(`${this.name}:${data[0]}`);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.failOnClose) throw new Error(`${this.name}: close failed`);
  }

  get bytes(): number[] {
    return this.writes.flat();
  }
}

function setup(withVideo = true) {
  const log: string[] = [];
  const vocal = new MemorySink(log, 'vocal', 6);
  const backing = new MemorySink(log, 'backing', 3);
  const video = withVideo ? new MemorySink(log, 'video', 4) : null;
  const recording = new TakeRecording({ vocal, backing, video });
  return { log, vocal, backing, video, recording };
}

/** One stereo float frame (8 bytes) filled with `value`. */
const frames = (value: number, count = 1): Uint8Array => new Uint8Array(8 * count).fill(value);

describe('TakeRecording', () => {
  it('writes every chunk in the order it was appended, stems in lockstep', async () => {
    const { log, vocal, backing, video, recording } = setup();
    recording.appendAudio(frames(1), frames(101));
    recording.appendVideo(new Uint8Array([201, 0, 0]));
    recording.appendAudio(frames(2, 3), frames(102, 3));
    recording.appendVideo(new Uint8Array([202]));
    recording.appendAudio(frames(3), frames(103));

    const sizes = await recording.close();

    expect(log).toEqual([
      'vocal:1',
      'backing:101',
      'video:201',
      'vocal:2',
      'backing:102',
      'video:202',
      'vocal:3',
      'backing:103',
    ]);
    expect(sizes).toEqual({ vocalBytes: 40, backingBytes: 40, videoBytes: 4 });
    expect(vocal.bytes.length).toBe(40);
    expect(backing.bytes.length).toBe(40);
    expect(vocal.closed && backing.closed && video?.closed).toBe(true);
  });

  it('remembers a mismatched stem chunk and reports it from close()', async () => {
    const { vocal, recording } = setup();
    recording.appendAudio(frames(1), frames(1));
    recording.appendAudio(frames(2, 2), frames(2, 1));
    recording.appendAudio(frames(3), frames(3));

    await expect(recording.close()).rejects.toThrow(/differ in length/);
    // The chunk before the bad one was written; nothing after it was.
    expect(vocal.writes.length).toBe(1);
    expect(vocal.closed).toBe(true);
  });

  it('rejects audio that is not a whole number of stereo float frames', async () => {
    const { recording } = setup();
    recording.appendAudio(new Uint8Array(12), new Uint8Array(12));
    await expect(recording.close()).rejects.toThrow(/whole number of frames/);
  });

  it('remembers the first write error, stops writing, and still closes the files', async () => {
    const { vocal, backing, video, recording } = setup();
    backing.failOnWrite = 1;
    recording.appendAudio(frames(1), frames(1));
    recording.appendAudio(frames(2), frames(2));
    recording.appendAudio(frames(3), frames(3));
    recording.appendVideo(new Uint8Array([9]));

    await expect(recording.close()).rejects.toThrow('backing: disk full');
    expect(vocal.writes.length).toBe(2);
    expect(backing.writes.length).toBe(1);
    expect(video?.writes.length).toBe(0);
    expect(vocal.closed && backing.closed && video?.closed).toBe(true);
  });

  it('treats a failed close as a recording failure', async () => {
    const { vocal, recording } = setup();
    vocal.failOnClose = true;
    recording.appendAudio(frames(1), frames(1));
    await expect(recording.close()).rejects.toThrow('vocal: close failed');
  });

  it('ignores empty chunks, video for an audio-only take, and anything after close', async () => {
    const { vocal, recording } = setup(false);
    recording.appendAudio(new Uint8Array(0), new Uint8Array(0));
    recording.appendVideo(new Uint8Array([1, 2, 3]));
    recording.appendAudio(frames(1), frames(1));
    const closing = recording.close();
    recording.appendAudio(frames(2), frames(2));

    expect(await closing).toEqual({ vocalBytes: 8, backingBytes: 8, videoBytes: 0 });
    expect(vocal.writes.length).toBe(1);
    expect(await recording.close()).toEqual({ vocalBytes: 8, backingBytes: 8, videoBytes: 0 });
  });
});
