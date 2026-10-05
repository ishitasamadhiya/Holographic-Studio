// Time alignment of the reference song (full mix) with the backing track the singer performs
// to, typically an instrumental version of the same recording.
import { RealFft, nextPowerOfTwo } from './fft';
import { ANALYSIS_SAMPLE_RATE } from './frames';
import { ENVELOPE_RATE_HZ, computeOnsetEnvelope, type OnsetEnvelope } from './onsetEnvelope';
import { assertValidSampleRate, monoMix, prepareChannel } from './pcm';
import type { AlignmentEstimate, StereoPcm } from './types';

export interface AlignmentOptions {
  /**
   * Largest |offset| searched, in seconds (>= 0; Infinity searches every offset the overlap
   * rule allows). Throws RangeError for a negative or NaN value.
   */
  maxOffsetSec?: number;
}

/** Different edits of a song differ by an intro or a count-in, rarely by more than this. */
export const DEFAULT_MAX_OFFSET_SEC = 30;

/** An offset is only considered when the two recordings overlap by at least this much... */
const MIN_OVERLAP_SEC = 5;
/** ...and by at least this fraction of the shorter one. */
const MIN_OVERLAP_FRACTION = 0.5;
/**
 * Runner-up peaks closer than this to the best one are part of the same peak (the envelope's
 * own autocorrelation width), not a competing alignment.
 */
const PEAK_EXCLUSION_SEC = 0.06;

// Confidence = fit x uniqueness. Measured on the synthetic test songs (alignment.test.ts):
//  - fit: normalised correlation of the onset envelopes at the best offset. An instrumental
//    against its own full mix reaches 0.85-0.97 (the vocal's onsets are the unmatched part);
//    unrelated songs stay below 0.1, or reach about 0.45 when they share tempo and drum pattern.
//  - uniqueness: how far the runner-up offset falls short of the best, as a fraction. About
//    0.5 for the same recording (the runner-up is a bar away); below 0.02 for songs that
//    merely share a tempo, which correlate equally well at every beat.
const FIT_FLOOR = 0.2;
const FIT_FULL = 0.5;
const UNIQUENESS_FULL = 0.25;

/** A fresh object each time: callers may annotate or modify what they get back. */
function noAlignment(): AlignmentEstimate {
  return { offsetSec: 0, confidence: 0 };
}

function onsetEnvelopeOf(pcm: StereoPcm): OnsetEnvelope {
  assertValidSampleRate(pcm);
  const mono = prepareChannel(monoMix(pcm), pcm.sampleRate, ANALYSIS_SAMPLE_RATE);
  return computeOnsetEnvelope(mono, ANALYSIS_SAMPLE_RATE);
}

/** Prefix sums of the envelope energy (all bands), for O(1) energy of any span. */
function energyPrefix(envelope: OnsetEnvelope): Float64Array {
  const prefix = new Float64Array(envelope.frameCount + 1);
  for (let frame = 0; frame < envelope.frameCount; frame++) {
    let energy = 0;
    for (const band of envelope.bands) energy += band[frame]! * band[frame]!;
    prefix[frame + 1] = prefix[frame]! + energy;
  }
  return prefix;
}

/**
 * Cross-correlation of the two multi-band envelopes for every lag, by FFT:
 * result[lag mod size] = sum over bands and t of reference[t + lag] * backing[t].
 */
function crossCorrelate(reference: OnsetEnvelope, backing: OnsetEnvelope): Float64Array {
  const size = nextPowerOfTwo(reference.frameCount + backing.frameCount);
  const fft = new RealFft(size);
  const refRe = new Float64Array(fft.binCount);
  const refIm = new Float64Array(fft.binCount);
  const backRe = new Float64Array(fft.binCount);
  const backIm = new Float64Array(fft.binCount);
  const crossRe = new Float64Array(fft.binCount);
  const crossIm = new Float64Array(fft.binCount);
  reference.bands.forEach((referenceBand, band) => {
    fft.forward(referenceBand, refRe, refIm);
    fft.forward(backing.bands[band]!, backRe, backIm);
    for (let bin = 0; bin < fft.binCount; bin++) {
      crossRe[bin]! += refRe[bin]! * backRe[bin]! + refIm[bin]! * backIm[bin]!;
      crossIm[bin]! += refIm[bin]! * backRe[bin]! - refRe[bin]! * backIm[bin]!;
    }
  });
  const correlation = new Float64Array(size);
  fft.inverse(crossRe, crossIm, correlation);
  return correlation;
}

/**
 * Estimates the offset between the backing track and the reference song such that
 * referenceTime = backingTime + offsetSec, from their onset patterns.
 *
 * The confidence is high only when the two recordings clearly share one performance: an
 * instrumental or karaoke version of the same recording. A cover, a remix at another tempo or
 * an unrelated song gives a low confidence, and the caller must then not trust the offset.
 */
export function estimateAlignment(
  backing: StereoPcm,
  reference: StereoPcm,
  options: AlignmentOptions = {},
): AlignmentEstimate {
  const maxOffsetSec = options.maxOffsetSec ?? DEFAULT_MAX_OFFSET_SEC;
  if (!(maxOffsetSec >= 0)) throw new RangeError(`Invalid maximum offset: ${maxOffsetSec}`);
  const backingEnvelope = onsetEnvelopeOf(backing);
  const referenceEnvelope = onsetEnvelopeOf(reference);
  const backingFrames = backingEnvelope.frameCount;
  const referenceFrames = referenceEnvelope.frameCount;
  const minOverlap = Math.max(
    MIN_OVERLAP_SEC * ENVELOPE_RATE_HZ,
    MIN_OVERLAP_FRACTION * Math.min(backingFrames, referenceFrames),
  );
  if (Math.min(backingFrames, referenceFrames) < minOverlap) return noAlignment();

  const correlation = crossCorrelate(referenceEnvelope, backingEnvelope);
  const backingEnergy = energyPrefix(backingEnvelope);
  const referenceEnergy = energyPrefix(referenceEnvelope);
  // Beyond this lag the two recordings cannot overlap by minOverlap in either direction.
  const largestUsefulLag = Math.floor(Math.max(backingFrames, referenceFrames) - minOverlap);
  const maxLag = Math.min(largestUsefulLag, Math.round(maxOffsetSec * ENVELOPE_RATE_HZ));

  // Normalised correlation per lag, over the part where the two recordings overlap.
  const scores = new Float32Array(2 * maxLag + 1).fill(Number.NEGATIVE_INFINITY);
  let bestLag = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const from = Math.max(0, -lag);
    const to = Math.min(backingFrames, referenceFrames - lag);
    if (to - from < minOverlap) continue;
    const energy =
      (backingEnergy[to]! - backingEnergy[from]!) *
      (referenceEnergy[to + lag]! - referenceEnergy[from + lag]!);
    if (energy <= 0) continue;
    const raw = correlation[lag >= 0 ? lag : correlation.length + lag]!;
    const score = raw / Math.sqrt(energy);
    scores[lag + maxLag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (!(bestScore > 0)) return noAlignment();

  const exclusion = Math.round(PEAK_EXCLUSION_SEC * ENVELOPE_RATE_HZ);
  let runnerUp = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    if (Math.abs(lag - bestLag) <= exclusion) continue;
    runnerUp = Math.max(runnerUp, scores[lag + maxLag]!);
  }

  // Parabolic refinement of the peak position to a fraction of an envelope frame.
  let refinedLag = bestLag;
  const below = scores[bestLag - 1 + maxLag];
  const above = scores[bestLag + 1 + maxLag];
  if (
    below !== undefined &&
    above !== undefined &&
    Number.isFinite(below) &&
    Number.isFinite(above)
  ) {
    const curvature = below - 2 * bestScore + above;
    if (curvature < 0) refinedLag += (0.5 * (below - above)) / curvature;
  }

  const fit = (bestScore - FIT_FLOOR) / (FIT_FULL - FIT_FLOOR);
  const uniqueness = (1 - runnerUp / bestScore) / UNIQUENESS_FULL;
  return {
    offsetSec: refinedLag / ENVELOPE_RATE_HZ,
    confidence: Math.min(1, Math.max(0, fit)) * Math.min(1, Math.max(0, uniqueness)),
  };
}
