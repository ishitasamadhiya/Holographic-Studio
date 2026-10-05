import { nextPowerOfTwo } from './math';

/**
 * Sample history for code that needs to look back over a window of recent samples.
 *
 * Every sample is written twice, `capacity` apart, so the most recent `capacity` samples are
 * always one contiguous run of `data` ending at `newestIndex`. Analysis loops can then index
 * backwards from `newestIndex` without wrapping or masking.
 */
export class MirroredHistory {
  readonly capacity: number = 0;
  readonly data: Float32Array;
  private writeIndex = 0;

  /** `minimumCapacity` is rounded up to a power of two. */
  constructor(minimumCapacity: number) {
    this.capacity = nextPowerOfTwo(Math.max(1, Math.ceil(minimumCapacity)));
    this.data = new Float32Array(this.capacity * 2);
  }

  /**
   * Index into `data` of the most recent sample. `data[newestIndex - k]` is the sample pushed
   * k steps earlier, for any k below `capacity`.
   */
  get newestIndex(): number {
    return this.writeIndex + this.capacity - 1;
  }

  /** Pushes `count` samples of `source`, starting at `offset`, oldest first. */
  pushBlock(source: Float32Array, offset: number, count: number): void {
    const data = this.data;
    const capacity = this.capacity;
    const mask = capacity - 1;
    let index = this.writeIndex;
    for (let i = 0; i < count; i++) {
      const sample = source[offset + i]!;
      data[index] = sample;
      data[index + capacity] = sample;
      index = (index + 1) & mask;
    }
    this.writeIndex = index;
  }

  clear(): void {
    this.data.fill(0);
    this.writeIndex = 0;
  }
}
