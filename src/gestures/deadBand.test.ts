import { describe, expect, it } from 'vitest';
import { DeadBand } from './deadBand';

describe('DeadBand', () => {
  it('holds still while the input trembles inside the band', () => {
    const band = new DeadBand(0.02);
    expect(band.update(0.5)).toBe(0.5);
    for (const tremor of [0.51, 0.495, 0.515, 0.482, 0.5, 0.519]) {
      expect(band.update(tremor)).toBe(0.5);
    }
  });

  it('follows a real move, trailing by at most the band and without steps', () => {
    const band = new DeadBand(0.02);
    band.update(0.5);
    let previous = 0.5;
    for (let step = 1; step <= 60; step += 1) {
      const input = 0.5 + step * 0.005;
      const output = band.update(input);
      expect(input - output).toBeLessThanOrEqual(0.02 + 1e-12);
      expect(output - previous).toBeLessThanOrEqual(0.005 + 1e-12);
      expect(output).toBeGreaterThanOrEqual(previous);
      previous = output;
    }
    expect(previous).toBeCloseTo(0.78, 9);
  });

  it('reverses only after the input has crossed the whole band', () => {
    const band = new DeadBand(0.02);
    band.update(0.5);
    expect(band.update(0.6)).toBeCloseTo(0.58, 12);
    expect(band.update(0.57)).toBeCloseTo(0.58, 12);
    expect(band.update(0.55)).toBeCloseTo(0.57, 12);
  });

  it('still reaches exactly 0 and exactly 1', () => {
    const band = new DeadBand(0.02);
    band.update(0.5);
    expect(band.update(1)).toBe(1);
    expect(band.update(0.995)).toBe(1);
    expect(band.update(0)).toBe(0);
    expect(band.update(0.004)).toBe(0);
  });

  it('starts afresh after reset', () => {
    const band = new DeadBand(0.02);
    band.update(0.5);
    band.reset();
    expect(band.update(0.51)).toBe(0.51);
  });
});
