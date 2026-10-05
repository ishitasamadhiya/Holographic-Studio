/** Small deterministic random source (mulberry32) so synthetic test songs are reproducible. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let mixed = this.state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max]. */
  integer(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new RangeError('Cannot pick from an empty list');
    return item;
  }

  /** Approximately standard-normal (sum of uniforms), bounded to +/-3. */
  gaussian(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * Math.sqrt(3);
  }

  /** White noise sample in [-1, 1). */
  noise(): number {
    return this.next() * 2 - 1;
  }
}
