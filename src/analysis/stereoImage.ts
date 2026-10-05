// How much the stereo image can be relied on to single out the lead vocal.
//
// Harmonic dominance says "one harmonic source holds this share of the vocal band". In a mix
// with a real stereo image the centre emphasis has already removed most of the accompaniment,
// so a modest share is a strong sign of a lead. Without stereo spread nothing has been removed
// and consonant accompaniment holds large shares too (the root of a chord explains half of the
// chord's own power), so only a clearly dominant source should be followed. Whether what is
// followed is sung at all is decided afterwards from the contour (voiceLikeness.ts).

/**
 * Stereo width = share of the vocal band's power that sits in the side signal (L-R)/2 over
 * the whole song. At or below this the material is mono for all practical purposes.
 */
const MONO_STEREO_WIDTH = 0.02;
/** From this width on the centre emphasis works at full strength (pop mixes: 0.1-0.3). */
const FULL_STEREO_WIDTH = 0.1;

/**
 * Harmonic dominance above which a frame counts toward "someone is singing", for a mix with a
 * full stereo image. In sections without a lead vocal the best candidate rarely exceeds
 * 0.2-0.3 and only for an instant; a lead as loud as its accompaniment sits around 0.5.
 */
const VOICING_THRESHOLD = 0.15;
/** The same for a mono mix, where only a clearly dominant source can be the lead. */
const MONO_VOICING_THRESHOLD = 0.45;

/** The narrower the mix, the more dominant a source must be to count as the lead. */
export function voicingThresholdFor(stereoWidth: number): number {
  const trust = (stereoWidth - MONO_STEREO_WIDTH) / (FULL_STEREO_WIDTH - MONO_STEREO_WIDTH);
  const clamped = Math.min(1, Math.max(0, trust));
  return MONO_VOICING_THRESHOLD + (VOICING_THRESHOLD - MONO_VOICING_THRESHOLD) * clamped;
}
