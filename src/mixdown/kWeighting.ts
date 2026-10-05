// The "K" frequency weighting of ITU-R BS.1770: a high shelf (the acoustic effect of the
// head) followed by a high-pass (the RLB curve). Loudness is the energy of the signal after
// these two filters.

/** Normalised biquad: y[n] = b0 x[n] + b1 x[n-1] + b2 x[n-2] - a1 y[n-1] - a2 y[n-2]. */
export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export interface KWeightingCoefficients {
  shelf: BiquadCoefficients;
  highPass: BiquadCoefficients;
}

// BS.1770 only tabulates coefficients for 48 kHz. These are the analogue prototype
// parameters that reproduce that table exactly, so the filters can be re-derived for any
// sample rate (the same approach as libebur128).
const SHELF_FREQUENCY_HZ = 1681.974450955533;
const SHELF_GAIN_DB = 3.999843853973347;
const SHELF_Q = 0.7071752369554196;
const SHELF_BAND_EXPONENT = 0.4996667741545416;
const HIGH_PASS_FREQUENCY_HZ = 38.13547087602444;
const HIGH_PASS_Q = 0.5003270373238773;

export function kWeightingCoefficients(sampleRate: number): KWeightingCoefficients {
  const shelfK = Math.tan((Math.PI * SHELF_FREQUENCY_HZ) / sampleRate);
  const shelfHighGain = 10 ** (SHELF_GAIN_DB / 20);
  const shelfBandGain = shelfHighGain ** SHELF_BAND_EXPONENT;
  const shelfNorm = 1 + shelfK / SHELF_Q + shelfK * shelfK;

  const highPassK = Math.tan((Math.PI * HIGH_PASS_FREQUENCY_HZ) / sampleRate);
  const highPassNorm = 1 + highPassK / HIGH_PASS_Q + highPassK * highPassK;

  return {
    shelf: {
      b0: (shelfHighGain + (shelfBandGain * shelfK) / SHELF_Q + shelfK * shelfK) / shelfNorm,
      b1: (2 * (shelfK * shelfK - shelfHighGain)) / shelfNorm,
      b2: (shelfHighGain - (shelfBandGain * shelfK) / SHELF_Q + shelfK * shelfK) / shelfNorm,
      a1: (2 * (shelfK * shelfK - 1)) / shelfNorm,
      a2: (1 - shelfK / SHELF_Q + shelfK * shelfK) / shelfNorm,
    },
    highPass: {
      b0: 1,
      b1: -2,
      b2: 1,
      a1: (2 * (highPassK * highPassK - 1)) / highPassNorm,
      a2: (1 - highPassK / HIGH_PASS_Q + highPassK * highPassK) / highPassNorm,
    },
  };
}

/** Magnitude response of one biquad at `frequencyHz`, as a linear gain. */
export function biquadMagnitude(
  coefficients: BiquadCoefficients,
  frequencyHz: number,
  sampleRate: number,
): number {
  const omega = (2 * Math.PI * frequencyHz) / sampleRate;
  const cos1 = Math.cos(omega);
  const sin1 = Math.sin(omega);
  const cos2 = Math.cos(2 * omega);
  const sin2 = Math.sin(2 * omega);
  const { b0, b1, b2, a1, a2 } = coefficients;
  const numerator = Math.hypot(b0 + b1 * cos1 + b2 * cos2, b1 * sin1 + b2 * sin2);
  const denominator = Math.hypot(1 + a1 * cos1 + a2 * cos2, a1 * sin1 + a2 * sin2);
  return numerator / denominator;
}
