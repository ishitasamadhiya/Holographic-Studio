import { describe, expect, it } from 'vitest';
import {
  sanitizeValue,
  type SliderRange,
  snapToDetent,
  snapToStep,
  valueAfterKey,
  valueFromPointer,
  stepToNeighbour,
  valueToFraction,
} from './sliderMath';

const unit: SliderRange = { min: 0, max: 1, step: 0.01 };
const offsetMs: SliderRange = { min: -200, max: 200, step: 5 };

describe('snapToStep', () => {
  it('rounds to the nearest step', () => {
    expect(snapToStep(0.123, unit)).toBe(0.12);
    expect(snapToStep(0.126, unit)).toBe(0.13);
    expect(snapToStep(13, offsetMs)).toBe(15);
    expect(snapToStep(-12, offsetMs)).toBe(-10);
  });

  it('removes floating-point noise', () => {
    expect(snapToStep(0.1 + 0.2, unit)).toBe(0.3);
    expect(snapToStep(0.07 * 3, unit)).toBe(0.21);
  });

  it('counts steps from the minimum, not from zero', () => {
    expect(snapToStep(4.4, { min: 1, max: 10, step: 2 })).toBe(5);
  });

  it('stays on the step grid when the minimum has more decimals than the step', () => {
    const halves: SliderRange = { min: 0.5, max: 3.5, step: 1 };
    expect(snapToStep(1.5, halves)).toBe(1.5);
    expect(snapToStep(1.2, halves)).toBe(1.5);
    expect(snapToStep(2.1, halves)).toBe(2.5);
    expect(snapToStep(0.15, { min: 0.05, max: 0.95, step: 0.1 })).toBe(0.15);
    expect(snapToStep(0.31, { min: 0.05, max: 0.95, step: 0.1 })).toBe(0.35);
    expect(snapToStep(-0.2, { min: -0.25, max: 0.75, step: 0.5 })).toBe(-0.25);
  });

  it('handles steps that are not powers of ten', () => {
    expect(snapToStep(0.3, { min: 0, max: 1, step: 0.25 })).toBe(0.25);
    expect(snapToStep(0.4, { min: 0, max: 1, step: 0.25 })).toBe(0.5);
  });

  it('clamps to the range', () => {
    expect(snapToStep(1.4, unit)).toBe(1);
    expect(snapToStep(-3, unit)).toBe(0);
  });
});

describe('valueToFraction', () => {
  it('maps the range onto 0..1', () => {
    expect(valueToFraction(0, offsetMs)).toBe(0.5);
    expect(valueToFraction(-200, offsetMs)).toBe(0);
    expect(valueToFraction(200, offsetMs)).toBe(1);
  });

  it('clamps out-of-range values and survives an empty range', () => {
    expect(valueToFraction(500, offsetMs)).toBe(1);
    expect(valueToFraction(3, { min: 3, max: 3, step: 1 })).toBe(0);
  });
});

describe('valueFromPointer', () => {
  it('converts a pointer position on the track into a stepped value', () => {
    expect(valueFromPointer(150, 100, 200, unit)).toBe(0.25);
    expect(valueFromPointer(200, 100, 200, offsetMs)).toBe(0);
  });

  it('clamps positions beyond either end of the track', () => {
    expect(valueFromPointer(20, 100, 200, unit)).toBe(0);
    expect(valueFromPointer(900, 100, 200, unit)).toBe(1);
  });

  it('returns the minimum for a track that has no width yet', () => {
    expect(valueFromPointer(50, 0, 0, offsetMs)).toBe(-200);
  });
});

describe('snapToDetent', () => {
  it('pulls nearby values onto the detent', () => {
    expect(snapToDetent(0.51, 0.5, unit)).toBe(0.5);
    expect(snapToDetent(0.485, 0.5, unit)).toBe(0.5);
  });

  it('leaves values outside the tolerance alone', () => {
    expect(snapToDetent(0.53, 0.5, unit)).toBe(0.53);
    expect(snapToDetent(0.46, 0.5, unit)).toBe(0.46);
  });

  it('scales the tolerance with the range', () => {
    expect(snapToDetent(5, 0, offsetMs)).toBe(0);
    expect(snapToDetent(10, 0, offsetMs)).toBe(10);
  });
});

describe('valueAfterKey', () => {
  it('moves one step with the arrow keys', () => {
    expect(valueAfterKey('ArrowRight', false, 0.5, unit, 0.1)).toBe(0.51);
    expect(valueAfterKey('ArrowUp', false, 0.5, unit, 0.1)).toBe(0.51);
    expect(valueAfterKey('ArrowLeft', false, 0.5, unit, 0.1)).toBe(0.49);
    expect(valueAfterKey('ArrowDown', false, 0.5, unit, 0.1)).toBe(0.49);
  });

  it('moves a large step with Shift or Page keys', () => {
    expect(valueAfterKey('ArrowRight', true, 0.5, unit, 0.1)).toBe(0.6);
    expect(valueAfterKey('PageUp', false, 0.5, unit, 0.1)).toBe(0.6);
    expect(valueAfterKey('PageDown', false, 0.5, unit, 0.1)).toBe(0.4);
  });

  it('jumps to the ends with Home and End', () => {
    expect(valueAfterKey('Home', false, 0.5, offsetMs, 50)).toBe(-200);
    expect(valueAfterKey('End', false, 0.5, offsetMs, 50)).toBe(200);
  });

  it('steps along a grid that starts at a fractional minimum', () => {
    const halves: SliderRange = { min: 0.5, max: 3.5, step: 1 };
    expect(valueAfterKey('ArrowRight', false, 0.5, halves, 1)).toBe(1.5);
    expect(valueAfterKey('ArrowRight', false, 1.5, halves, 1)).toBe(2.5);
    expect(valueAfterKey('ArrowLeft', false, 1.5, halves, 1)).toBe(0.5);
  });

  it('never leaves the range', () => {
    expect(valueAfterKey('ArrowRight', false, 1, unit, 0.1)).toBe(1);
    expect(valueAfterKey('PageDown', false, 0.04, unit, 0.1)).toBe(0);
  });

  it('steps to the neighbouring grid point from a value off the grid', () => {
    const thirds: SliderRange = { min: 0, max: 1, step: 0.3 };
    // End lands on the max, which is not a whole number of steps from the min.
    expect(valueAfterKey('ArrowLeft', false, 1, thirds, 0.1)).toBe(0.9);
    expect(valueAfterKey('ArrowRight', false, 0.9, thirds, 0.1)).toBe(1);
    expect(valueAfterKey('ArrowRight', false, 0.45, thirds, 0.1)).toBe(0.6);
    expect(valueAfterKey('ArrowLeft', false, 0.45, thirds, 0.1)).toBe(0.3);
  });

  it('still moves with the arrow keys when there is no step grid', () => {
    const free: SliderRange = { min: 0, max: 1, step: 0 };
    expect(valueAfterKey('ArrowRight', false, 0.5, free, 0.1)).toBe(0.51);
    expect(valueAfterKey('ArrowLeft', false, 0.5, free, 0.1)).toBe(0.49);
    expect(valueAfterKey('ArrowRight', false, 1, free, 0.1)).toBe(1);
  });

  it('returns null for keys it does not handle', () => {
    expect(valueAfterKey('Enter', false, 0.5, unit, 0.1)).toBeNull();
    expect(valueAfterKey('a', false, 0.5, unit, 0.1)).toBeNull();
  });
});

describe('stepToNeighbour', () => {
  it('moves exactly one step from a value on the grid, without float noise', () => {
    let value = 0;
    for (let press = 0; press < 100; press += 1) value = stepToNeighbour(value, 1, unit);
    expect(value).toBe(1);
    expect(stepToNeighbour(0.51, -1, unit)).toBe(0.5);
    expect(stepToNeighbour(-5, 1, offsetMs)).toBe(0);
  });
});

describe('sanitizeValue', () => {
  it('clamps out-of-range values', () => {
    expect(sanitizeValue(5, unit)).toBe(1);
    expect(sanitizeValue(-300, offsetMs)).toBe(-200);
    expect(sanitizeValue(0.4, unit)).toBe(0.4);
  });

  it('falls back to the minimum for values that are not finite', () => {
    expect(sanitizeValue(Number.NaN, offsetMs)).toBe(-200);
    expect(sanitizeValue(Number.POSITIVE_INFINITY, unit)).toBe(0);
  });
});
