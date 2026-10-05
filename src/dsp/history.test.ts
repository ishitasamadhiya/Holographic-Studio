import { describe, expect, it } from 'vitest';
import { MirroredHistory } from './history';

describe('MirroredHistory', () => {
  it('rounds its capacity up to a power of two', () => {
    expect(new MirroredHistory(1000).capacity).toBe(1024);
    expect(new MirroredHistory(16).capacity).toBe(16);
    expect(new MirroredHistory(0).capacity).toBe(1);
  });

  it('keeps the most recent samples contiguous behind newestIndex at every write position', () => {
    const history = new MirroredHistory(16);
    const counting = Float32Array.from({ length: 100 }, (_, n) => n);
    for (let n = 0; n < counting.length; n++) {
      history.pushBlock(counting, n, 1);
      const available = Math.min(n + 1, history.capacity);
      for (let back = 0; back < available; back++) {
        expect(history.data[history.newestIndex - back]).toBe(n - back);
      }
      expect(history.newestIndex - (history.capacity - 1)).toBeGreaterThanOrEqual(0);
      expect(history.newestIndex).toBeLessThan(history.data.length);
    }
  });

  it('gives the same history whatever the size of the blocks pushed', () => {
    const source = Float32Array.from({ length: 300 }, (_, n) => Math.sin(n));
    const oneByOne = new MirroredHistory(32);
    for (let n = 0; n < source.length; n++) oneByOne.pushBlock(source, n, 1);
    const inBlocks = new MirroredHistory(32);
    for (let offset = 0; offset < source.length;) {
      const count = Math.min(1 + ((offset * 5) % 31), source.length - offset);
      inBlocks.pushBlock(source, offset, count);
      offset += count;
    }
    expect(inBlocks.newestIndex).toBe(oneByOne.newestIndex);
    expect(Array.from(inBlocks.data)).toEqual(Array.from(oneByOne.data));
    for (let back = 0; back < 32; back++) {
      expect(inBlocks.data[inBlocks.newestIndex - back]).toBe(source[source.length - 1 - back]);
    }
  });

  it('forgets everything when cleared', () => {
    const history = new MirroredHistory(8);
    history.pushBlock(
      Float32Array.from({ length: 20 }, (_, n) => n + 1),
      0,
      20,
    );
    history.clear();
    expect(Array.from(history.data).every((sample) => sample === 0)).toBe(true);
    history.pushBlock(Float32Array.of(7), 0, 1);
    expect(history.data[history.newestIndex]).toBe(7);
    expect(history.data[history.newestIndex - 1]).toBe(0);
  });
});
