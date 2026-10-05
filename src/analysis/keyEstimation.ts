// Key and scale from pitch-class statistics (Krumhansl-Schmuckler profile correlation).
import { SCALE_INTERVALS, type KeyEstimate, type MelodyNote, type ScaleMode } from '@shared/music';

/** Krumhansl & Kessler's probe-tone ratings: how well each scale degree "fits" a key. */
const KEY_PROFILES: Record<ScaleMode, readonly number[]> = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

/** Correlation with the best key at or below which nothing key-like is present. */
const CORRELATION_FLOOR = 0.5;
/** Correlation at which the fit is as good as it gets for real music. */
const CORRELATION_FULL = 0.8;
/** Lead over the best key with a different set of notes that counts as unambiguous. */
const MARGIN_FULL = 0.15;
/**
 * Correlation ignores how pronounced a profile is: the ripple on an almost flat distribution
 * (noise, atonal music) can correlate with some key as well as a real tonal profile does. So
 * the profile's relative spread (standard deviation / mean) must also be key-like; tonal music
 * is far above CONTRAST_FULL, a flat profile is below CONTRAST_FLOOR.
 */
const CONTRAST_FLOOR = 0.1;
const CONTRAST_FULL = 0.25;

function correlation(a: readonly number[], b: readonly number[]): number {
  const count = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < count; index++) {
    meanA += a[index]! / count;
    meanB += b[index]! / count;
  }
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < count; index++) {
    const da = a[index]! - meanA;
    const db = b[index]! - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  const scale = Math.sqrt(varianceA * varianceB);
  return scale > 0 ? covariance / scale : 0;
}

function relativeSpread(profile: readonly number[]): number {
  const mean = profile.reduce((sum, value) => sum + value, 0) / profile.length;
  if (mean <= 0) return 0;
  const variance = profile.reduce((sum, value) => sum + (value - mean) ** 2, 0) / profile.length;
  return Math.sqrt(variance) / mean;
}

function ramp(value: number, floor: number, full: number): number {
  return Math.min(1, Math.max(0, (value - floor) / (full - floor)));
}

function scaleMask(tonic: number, mode: ScaleMode): number {
  let mask = 0;
  for (const interval of SCALE_INTERVALS[mode]) mask |= 1 << ((tonic + interval) % 12);
  return mask;
}

function normalized(profile: readonly number[]): number[] {
  const total = profile.reduce((sum, value) => sum + value, 0);
  return profile.map((value) => (total > 0 ? value / total : 0));
}

/** Duration-weighted pitch-class histogram of the melody notes. */
export function melodyPitchClassProfile(notes: readonly MelodyNote[]): number[] {
  const profile = new Array<number>(12).fill(0);
  for (const note of notes) {
    profile[((note.midi % 12) + 12) % 12]! += note.endSec - note.startSec;
  }
  return profile;
}

export interface PitchClassEvidence {
  /** Twelve non-negative weights, index 0 = C. Any scale; it is normalised to sum 1. */
  profile: readonly number[];
  /** Relative say of this source in the combined profile. */
  weight: number;
}

/**
 * Estimates the key from one or more pitch-class profiles (all-zero profiles are ignored).
 *
 * Confidence combines how well the best key fits, how pronounced the profile is, and the best
 * key's lead over the best key that has a DIFFERENT set of notes. A relative major/minor pair
 * (C major / A minor) shares all seven notes, so confusing the two is harmless for snapping a
 * voice to the scale and is not held against the estimate.
 */
export function estimateKey(sources: readonly PitchClassEvidence[]): KeyEstimate {
  const combined = new Array<number>(12).fill(0);
  for (const source of sources) {
    normalized(source.profile).forEach((value, index) => {
      combined[index]! += source.weight * value;
    });
  }

  let best: { tonic: number; mode: ScaleMode; score: number } = {
    tonic: 0,
    mode: 'major',
    score: Number.NEGATIVE_INFINITY,
  };
  const scores: { tonic: number; mode: ScaleMode; score: number }[] = [];
  for (const mode of ['major', 'minor'] as const) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const rotated = KEY_PROFILES[mode].map(
        (_, index) => KEY_PROFILES[mode][(index - tonic + 12) % 12]!,
      );
      const score = correlation(combined, rotated);
      scores.push({ tonic, mode, score });
      if (score > best.score) best = { tonic, mode, score };
    }
  }

  const bestMask = scaleMask(best.tonic, best.mode);
  let rival = -1;
  for (const candidate of scores) {
    if (scaleMask(candidate.tonic, candidate.mode) !== bestMask && candidate.score > rival) {
      rival = candidate.score;
    }
  }

  const confidence =
    ramp(best.score, CORRELATION_FLOOR, CORRELATION_FULL) *
    ramp(best.score - rival, 0, MARGIN_FULL) *
    ramp(relativeSpread(combined), CONTRAST_FLOOR, CONTRAST_FULL);
  return { tonic: best.tonic, mode: best.mode, confidence };
}
