/** Decoded audio as handed over by the renderer. `right` is null for mono files. */
export interface StereoPcm {
  left: Float32Array;
  right: Float32Array | null;
  sampleRate: number;
}

/**
 * Time offset between the reference song and the backing track:
 * referenceTime = backingTime + offsetSec.
 */
export interface AlignmentEstimate {
  offsetSec: number;
  /** 0..1 — how unambiguous the best offset was. */
  confidence: number;
}
