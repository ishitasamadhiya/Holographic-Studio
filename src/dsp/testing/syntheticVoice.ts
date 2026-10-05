// Synthetic test signals: a sung vowel with controllable pitch behaviour, plain harmonic
// tones, and noise. Test-only code; never imported by the live audio path.
import { midiToHz } from '@shared/music';
import { createGaussian, createRandom } from './random';

/** Formant centre frequencies and bandwidths (Hz) of an open "ah" vowel. */
const FORMANTS = [
  { hz: 730, bandwidthHz: 90 },
  { hz: 1090, bandwidthHz: 110 },
  { hz: 2440, bandwidthHz: 170 },
  { hz: 3400, bandwidthHz: 250 },
] as const;

/** Harmonics above this frequency are not generated (the vowel has no energy left there). */
const HARMONIC_LIMIT_HZ = 9000;
/** Onsets and releases are faded over this time so notes do not start with a click. */
const ENVELOPE_SEC = 0.008;
/** Breath noise is high-passed: aspiration lives above the first formant. */
const BREATH_HIGHPASS_HZ = 1500;

export interface SyntheticVoiceOptions {
  sampleRate: number;
  durationSec: number;
  /**
   * Sung pitch as a MIDI note number (fractions allowed): a constant or a function of time.
   * NaN means a rest (the voice fades out and is silent).
   */
  midi: number | ((timeSec: number) => number);
  /** Vibrato rate in Hz. Default 5.5. */
  vibratoHz?: number;
  /** Vibrato depth: peak deviation in cents. Default 0 (none). */
  vibratoCents?: number;
  /** Cycle-to-cycle random pitch variation, standard deviation in cents. Default 0. */
  jitterCents?: number;
  /** Breath noise RMS relative to the voice RMS. Default 0. */
  breathLevel?: number;
  /** Scales the first harmonic; small values give a voice with a weak fundamental. Default 1. */
  fundamentalGain?: number;
  /** RMS level of the voiced sound. Default 0.1 (-20 dBFS). */
  level?: number;
  seed?: number;
}

/**
 * Gain of the vocal tract at a frequency: a cascade of second-order resonators (the classic
 * all-pole formant model). Each has unity gain at DC and a peak of roughly hz / bandwidth, so
 * a harmonic sitting on a formant is boosted by 15–20 dB while the fundamental keeps a
 * realistic share of the energy.
 */
function formantGain(frequencyHz: number): number {
  let inversePower = 1;
  for (const formant of FORMANTS) {
    const relative = frequencyHz / formant.hz;
    const detune = 1 - relative * relative;
    const damping = (frequencyHz * formant.bandwidthHz) / (formant.hz * formant.hz);
    inversePower *= detune * detune + damping * damping;
  }
  return 1 / Math.sqrt(inversePower);
}

/**
 * A sung vowel built by additive synthesis: a harmonic series with the -6 dB/octave tilt of a
 * glottal source, shaped by vowel formants that stay put while the pitch moves (so harmonic
 * levels change with pitch, as in a real voice). Free of aliasing, with an exactly known
 * pitch at every sample.
 */
export function synthesizeVoice(options: SyntheticVoiceOptions): Float32Array {
  const { sampleRate, durationSec } = options;
  const vibratoHz = options.vibratoHz ?? 5.5;
  const vibratoCents = options.vibratoCents ?? 0;
  const jitterCents = options.jitterCents ?? 0;
  const breathLevel = options.breathLevel ?? 0;
  const fundamentalGain = options.fundamentalGain ?? 1;
  const level = options.level ?? 0.1;
  const midiAt = typeof options.midi === 'number' ? () => options.midi as number : options.midi;

  const random = createRandom(options.seed ?? 1);
  const gaussian = createGaussian(random);
  const frameCount = Math.round(durationSec * sampleRate);
  const output = new Float32Array(frameCount);
  const envelopeStep = 1 / (ENVELOPE_SEC * sampleRate);
  const breathCoefficient = 1 - Math.exp((-2 * Math.PI * BREATH_HIGHPASS_HZ) / sampleRate);

  let phase = 0;
  let envelope = 0;
  let jitterOffsetCents = 0;
  let lastMidi = 60;
  let breathLowpass = 0;

  for (let n = 0; n < frameCount; n++) {
    const timeSec = n / sampleRate;
    const requestedMidi = midiAt(timeSec);
    const sounding = !Number.isNaN(requestedMidi);
    if (sounding) lastMidi = requestedMidi;
    envelope = Math.min(1, Math.max(0, envelope + (sounding ? envelopeStep : -envelopeStep)));

    const vibrato = vibratoCents * Math.sin(2 * Math.PI * vibratoHz * timeSec);
    const f0Hz = midiToHz(lastMidi + (vibrato + jitterOffsetCents) / 100);
    phase += (2 * Math.PI * f0Hz) / sampleRate;
    if (phase >= 2 * Math.PI) {
      phase -= 2 * Math.PI;
      jitterOffsetCents = jitterCents * gaussian();
    }

    // sin(k·phase) for k = 1, 2, 3… by the Chebyshev recurrence: one sin/cos per sample.
    const twoCos = 2 * Math.cos(phase);
    let previous = 0;
    let current = Math.sin(phase);
    let sum = 0;
    let power = 0;
    const harmonicCount = Math.floor(Math.min(HARMONIC_LIMIT_HZ, 0.45 * sampleRate) / f0Hz);
    for (let k = 1; k <= harmonicCount; k++) {
      const amplitude = (formantGain(k * f0Hz) / k) * (k === 1 ? fundamentalGain : 1);
      sum += amplitude * current;
      power += 0.5 * amplitude * amplitude;
      const next = twoCos * current - previous;
      previous = current;
      current = next;
    }
    const voiced = power > 0 ? (sum / Math.sqrt(power)) * level : 0;

    const white = gaussian();
    breathLowpass += breathCoefficient * (white - breathLowpass);
    const breath = (white - breathLowpass) * breathLevel * level;

    output[n] = envelope * (voiced + breath);
  }
  return output;
}

export interface HarmonicToneOptions {
  sampleRate: number;
  durationSec: number;
  f0Hz: number;
  /** Amplitude of each harmonic, starting with the fundamental. */
  harmonics: readonly number[];
  /** Peak-normalization target. Default 0.5. */
  peak?: number;
}

/** A steady tone made of the given harmonics, with staggered phases so it is not an impulse train. */
export function harmonicTone(options: HarmonicToneOptions): Float32Array {
  const { sampleRate, durationSec, f0Hz, harmonics } = options;
  const frameCount = Math.round(durationSec * sampleRate);
  const output = new Float32Array(frameCount);
  let largest = 0;
  for (let n = 0; n < frameCount; n++) {
    let sum = 0;
    for (let k = 0; k < harmonics.length; k++) {
      const phase = (2 * Math.PI * (k + 1) * f0Hz * n) / sampleRate + 1.3 * k * k;
      sum += harmonics[k]! * Math.sin(phase);
    }
    output[n] = sum;
    largest = Math.max(largest, Math.abs(sum));
  }
  const scale = largest > 0 ? (options.peak ?? 0.5) / largest : 0;
  for (let n = 0; n < frameCount; n++) output[n] = output[n]! * scale;
  return output;
}

/** Gaussian white noise with the given RMS level. */
export function whiteNoise(
  sampleRate: number,
  durationSec: number,
  rmsLevel: number,
  seed = 1,
): Float32Array {
  const gaussian = createGaussian(createRandom(seed));
  const output = new Float32Array(Math.round(durationSec * sampleRate));
  for (let n = 0; n < output.length; n++) output[n] = rmsLevel * gaussian();
  return output;
}
