// Musical data shared by reference analysis, the realtime autotune, and the UI.

export const A4_HZ = 440;
export const A4_MIDI = 69;

export type ScaleMode = 'major' | 'minor';

/** Semitone offsets from the tonic for the scales the autotune can snap to. */
export const SCALE_INTERVALS: Record<ScaleMode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export const PITCH_CLASS_NAMES = [
  'C',
  'C♯',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
] as const;

export interface KeyEstimate {
  /** Pitch class of the tonic: 0 = C, 1 = C♯ … 11 = B. */
  tonic: number;
  mode: ScaleMode;
  /** 0..1 — how clearly this key beat the alternatives. */
  confidence: number;
}

/** One sung note of the reference lead melody. */
export interface MelodyNote {
  startSec: number;
  endSec: number;
  /** Integer MIDI note number. The true pitch also includes ReferenceAnalysis.tuningCents. */
  midi: number;
  /** 0..1 */
  confidence: number;
}

/** Frame-by-frame lead-vocal pitch estimate. */
export interface PitchContour {
  /** Seconds between frames. */
  hopSec: number;
  /** Fundamental frequency per frame in Hz; 0 where no lead vocal was detected. */
  f0Hz: number[];
  /** 0..1 per frame. */
  confidence: number[];
}

/**
 * How far the melody can be trusted as a pitch target.
 * 'poor' means the autotune must ignore the melody and fall back to the key/scale only.
 */
export type MelodyQuality = 'good' | 'fair' | 'poor';

export const REFERENCE_ANALYSIS_SCHEMA_VERSION = 1;

/** Everything learned from the original/reference song. Cached on disk as JSON. */
export interface ReferenceAnalysis {
  schemaVersion: typeof REFERENCE_ANALYSIS_SCHEMA_VERSION;
  durationSec: number;
  contour: PitchContour;
  notes: MelodyNote[];
  key: KeyEstimate;
  /** How far the song's tuning sits from A = 440 Hz, in cents (-50..50). */
  tuningCents: number;
  quality: MelodyQuality;
  stats: {
    /** Fraction of frames where a lead vocal was found. */
    voicedRatio: number;
    meanConfidence: number;
    noteCount: number;
  };
}

/**
 * The compact form of the pitch targets that is handed to the realtime audio thread.
 * Times are in SONG time (the backing track's clock), i.e. already shifted by the
 * reference-to-backing alignment offset.
 */
export interface PitchTargetData {
  /** Flat [startSec, endSec, midi] triples sorted by startSec. Empty = no melody guidance. */
  notes: Float32Array;
  /** Scale to snap to when no melody note applies. null = chromatic. */
  key: KeyEstimate | null;
  tuningCents: number;
}

export function hzToMidi(hz: number): number {
  return A4_MIDI + 12 * Math.log2(hz / A4_HZ);
}

export function midiToHz(midi: number): number {
  return A4_HZ * 2 ** ((midi - A4_MIDI) / 12);
}

export function describeKey(key: KeyEstimate): string {
  return `${PITCH_CLASS_NAMES[((key.tonic % 12) + 12) % 12]} ${key.mode}`;
}

/** Structural check used when loading a cached analysis from disk. */
export function isReferenceAnalysis(value: unknown): value is ReferenceAnalysis {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ReferenceAnalysis>;
  return (
    candidate.schemaVersion === REFERENCE_ANALYSIS_SCHEMA_VERSION &&
    typeof candidate.durationSec === 'number' &&
    typeof candidate.tuningCents === 'number' &&
    typeof candidate.contour === 'object' &&
    candidate.contour !== null &&
    Array.isArray(candidate.contour.f0Hz) &&
    Array.isArray(candidate.contour.confidence) &&
    Array.isArray(candidate.notes) &&
    typeof candidate.key === 'object' &&
    candidate.key !== null &&
    typeof candidate.key.tonic === 'number' &&
    (candidate.key.mode === 'major' || candidate.key.mode === 'minor') &&
    (candidate.quality === 'good' || candidate.quality === 'fair' || candidate.quality === 'poor')
  );
}
