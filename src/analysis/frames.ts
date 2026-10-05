// Framing shared by every stage of the melody analysis.
import { hzToMidi, midiToHz } from '@shared/music';

/** All analysis happens at this rate; nothing above ~6 kHz is needed to follow a voice. */
export const ANALYSIS_SAMPLE_RATE = 16_000;

/**
 * 64 ms Hann window: long enough to resolve the harmonics of the lowest voices (80 Hz apart),
 * short enough that vibrato and glides do not smear the upper harmonics too much.
 */
export const FRAME_SIZE = 1024;
/** Zero-padded 2x so that linear interpolation between bins is accurate. */
export const FFT_SIZE = 2048;
export const HOP_SIZE = 160;
export const HOP_SEC = HOP_SIZE / ANALYSIS_SAMPLE_RATE;
export const BIN_HZ = ANALYSIS_SAMPLE_RATE / FFT_SIZE;
export const SPECTRUM_BIN_COUNT = FFT_SIZE / 2 + 1;

/** Candidate fundamentals: a 10-cent grid from just below the lowest bass notes to soprano C6. */
export const PITCH_MIN_HZ = 75;
export const PITCH_MAX_HZ = 1100;
export const PITCH_BINS_PER_SEMITONE = 10;
export const PITCH_MIN_MIDI = hzToMidi(PITCH_MIN_HZ);
export const PITCH_BIN_COUNT =
  Math.ceil((hzToMidi(PITCH_MAX_HZ) - PITCH_MIN_MIDI) * PITCH_BINS_PER_SEMITONE) + 1;

/**
 * Partials considered per pitch candidate, by both the salience and the dominance measure (which
 * must agree on which partials belong to a candidate). Only the lowest voices have this many
 * inside the analysis band.
 */
export const MAX_HARMONICS = 40;

/** MIDI pitch (fractional) of a position on the pitch grid; `bin` may be fractional. */
export function pitchBinToMidi(bin: number): number {
  return PITCH_MIN_MIDI + bin / PITCH_BINS_PER_SEMITONE;
}

export function pitchBinToHz(bin: number): number {
  return midiToHz(pitchBinToMidi(bin));
}

/** Number of analysis frames for a signal; frame t is centred on sample t * HOP_SIZE. */
export function frameCountFor(sampleCount: number): number {
  return Math.round(sampleCount / HOP_SIZE);
}

export function hannWindow(size: number): Float64Array {
  const window = new Float64Array(size);
  for (let index = 0; index < size; index++) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  }
  return window;
}
