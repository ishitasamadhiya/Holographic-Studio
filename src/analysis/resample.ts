// Sample-rate conversion with a Kaiser-windowed sinc low-pass (polyphase FIR), zero-phase.

/** Kernel reach on each side, in zero crossings of the sinc. */
const SINC_ZERO_CROSSINGS = 11;
/** Kaiser beta for roughly 70 dB of stop-band attenuation. */
const KAISER_BETA = 6.76;
/**
 * Upper bound on stored filter phases. Common rate pairs need far fewer (48 kHz -> 16 kHz needs
 * one, 44.1 kHz -> 16 kHz needs 160); unusual pairs fall back to the nearest of this many
 * phases, i.e. a timing error below a thousandth of an input sample.
 */
const MAX_PHASES = 1024;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const quarterSquare = (x * x) / 4;
  for (let k = 1; k < 40; k++) {
    term *= quarterSquare / (k * k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

function phaseCountFor(inputRate: number, outputRate: number): number {
  if (!Number.isInteger(inputRate) || !Number.isInteger(outputRate)) return MAX_PHASES;
  const exactPhases = outputRate / greatestCommonDivisor(inputRate, outputRate);
  return Math.min(exactPhases, MAX_PHASES);
}

/**
 * Converts `input` from `inputRate` to `outputRate`.
 *
 * The low-pass has its -6 dB point at the lower of the two Nyquist frequencies, with a
 * transition band of +/-20 % around it. When decimating, content just above the new Nyquist
 * therefore folds back only into the top 20 % of the new band; callers that need alias-free
 * content must stay below 0.4 * outputRate (the analysis uses nothing above that).
 */
export function resample(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (!(inputRate > 0) || !(outputRate > 0)) {
    throw new RangeError(`Sample rates must be positive, got ${inputRate} -> ${outputRate}`);
  }
  if (inputRate === outputRate) return input.slice();

  const step = inputRate / outputRate;
  const outputLength = Math.floor(input.length / step);
  const output = new Float32Array(outputLength);

  // Cutoff as a fraction of the input sample rate; the kernel is stretched when decimating.
  const cutoff = Math.min(1, outputRate / inputRate);
  const halfWidth = Math.ceil(SINC_ZERO_CROSSINGS / cutoff);
  const tapCount = 2 * halfWidth + 1;
  const phaseCount = phaseCountFor(inputRate, outputRate);

  // taps[phase][j] weighs input sample (floor(position) - halfWidth + j) for a fractional
  // position of phase / phaseCount.
  const taps = new Float32Array(phaseCount * tapCount);
  const windowNorm = besselI0(KAISER_BETA);
  for (let phase = 0; phase < phaseCount; phase++) {
    const fraction = phase / phaseCount;
    let sum = 0;
    for (let tap = 0; tap < tapCount; tap++) {
      const distance = tap - halfWidth - fraction;
      const windowPosition = distance / (halfWidth + 1);
      let value = 0;
      if (Math.abs(windowPosition) < 1) {
        const x = Math.PI * cutoff * distance;
        const sinc = distance === 0 ? 1 : Math.sin(x) / x;
        const window =
          besselI0(KAISER_BETA * Math.sqrt(1 - windowPosition * windowPosition)) / windowNorm;
        value = cutoff * sinc * window;
      }
      taps[phase * tapCount + tap] = value;
      sum += value;
    }
    // Unity gain at DC for every phase, so the phases do not modulate the level.
    for (let tap = 0; tap < tapCount; tap++) taps[phase * tapCount + tap]! /= sum;
  }

  const lastInput = input.length - 1;
  for (let n = 0; n < outputLength; n++) {
    const position = n * step;
    let base = Math.floor(position);
    let phase = Math.round((position - base) * phaseCount);
    if (phase === phaseCount) {
      phase = 0;
      base += 1;
    }
    const first = base - halfWidth;
    const tapOffset = phase * tapCount;
    const from = first < 0 ? -first : 0;
    const to = first + tapCount - 1 > lastInput ? lastInput - first + 1 : tapCount;
    let sum = 0;
    for (let tap = from; tap < to; tap++) {
      sum += input[first + tap]! * taps[tapOffset + tap]!;
    }
    output[n] = sum;
  }
  return output;
}
