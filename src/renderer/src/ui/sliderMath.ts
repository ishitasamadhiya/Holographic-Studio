// Pure value maths for the Slider, kept apart from React so it can be unit-tested.

export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

function decimalPlaces(value: number): number {
  const text = String(value);
  const exponent = text.indexOf('e-');
  if (exponent >= 0) return Number(text.slice(exponent + 2));
  const point = text.indexOf('.');
  return point < 0 ? 0 : text.length - point - 1;
}

export function clampToRange(value: number, { min, max }: SliderRange): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Rounds to the nearest step counted from `min`, then clamps. The final rounding removes
 * binary floating-point noise (0.1 + 0.2 → 0.3, not 0.30000…04); it keeps as many decimals
 * as the finer of `min` and `step` has, because every point of the grid min + k × step needs
 * exactly that many (min 0.5 with step 1 gives 0.5, 1.5, 2.5, …).
 */
export function snapToStep(value: number, range: SliderRange): number {
  const { min, step } = range;
  if (step <= 0) return clampToRange(value, range);
  const snapped = min + Math.round((value - min) / step) * step;
  const decimals = Math.max(decimalPlaces(step), decimalPlaces(min));
  return clampToRange(Number(snapped.toFixed(decimals)), range);
}

/** Position of `value` along the track, 0..1. */
export function valueToFraction(value: number, range: SliderRange): number {
  const span = range.max - range.min;
  if (span <= 0) return 0;
  return (clampToRange(value, range) - range.min) / span;
}

/** The stepped value under a pointer at `clientX` for a track at `trackLeft`..+`trackWidth`. */
export function valueFromPointer(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  range: SliderRange,
): number {
  if (trackWidth <= 0) return range.min;
  const fraction = Math.min(1, Math.max(0, (clientX - trackLeft) / trackWidth));
  return snapToStep(range.min + fraction * (range.max - range.min), range);
}

/**
 * A magnetic detent: when a dragged value comes within `toleranceFraction` of the range from
 * `detent`, it lands exactly on it. Makes "back to unity" easy to hit without looking.
 */
export function snapToDetent(
  value: number,
  detent: number,
  range: SliderRange,
  toleranceFraction = 0.02,
): number {
  const tolerance = (range.max - range.min) * toleranceFraction;
  return Math.abs(value - detent) <= tolerance ? detent : value;
}

/**
 * The value after a key press, or null when the key is not one the slider handles.
 * Arrows move one step, Shift+arrow and Page Up/Down move `largeStep`, Home/End jump to the ends.
 */
export function valueAfterKey(
  key: string,
  shiftKey: boolean,
  value: number,
  range: SliderRange,
  largeStep: number,
): number | null {
  const small = shiftKey ? largeStep : range.step;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return snapToStep(value + small, range);
    case 'ArrowLeft':
    case 'ArrowDown':
      return snapToStep(value - small, range);
    case 'PageUp':
      return snapToStep(value + largeStep, range);
    case 'PageDown':
      return snapToStep(value - largeStep, range);
    case 'Home':
      return range.min;
    case 'End':
      return range.max;
    default:
      return null;
  }
}
