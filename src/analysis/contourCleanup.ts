// Tidies the tracked melody: bridges drop-outs, removes single-frame glitches and discards
// fragments that are too short or too weak to be a sung note.
import type { TrackedMelody } from './melodyTracker';

/**
 * The tracker may carry a note across a few weak frames, but a frame with practically no energy
 * at the pitch is not sung: this is how the gap of a consonant between two notes is recovered.
 */
const MIN_FRAME_DOMINANCE = 0.05;
/** Drop-outs up to this long inside a note (a drum hit masking the voice) are bridged. */
const MAX_BRIDGED_GAP_FRAMES = 4;
/** A gap is only bridged when the pitch on both sides is this close: it is the same note. */
const MAX_BRIDGED_PITCH_STEP = 1;
/** 5 frames = 50 ms: removes one- and two-frame outliers, keeps vibrato (period >= 140 ms). */
const MEDIAN_WINDOW_FRAMES = 5;
/** Voiced stretches shorter than this are not notes. */
export const MIN_VOICED_RUN_FRAMES = 8;
/**
 * Minimum evidence for a voiced stretch: the sum over its frames of dominance above the voicing
 * threshold. 3 is what 100 ms at dominance 0.45 or 300 ms at 0.25 add up to. Accompaniment
 * that briefly looks like a lead (a pad partial drifting into phase between the channels, a
 * centred drum resonance) produces short AND weak stretches; real notes are one or the other
 * at worst. On the synthetic test songs this removes 97 % of such frames and 1 % of sung ones.
 */
const MIN_RUN_EVIDENCE = 3;

function isVoiced(pitch: number): boolean {
  return !Number.isNaN(pitch);
}

/** Calls `visit(start, end)` for every maximal run of voiced frames (`end` is exclusive). */
export function forEachVoicedRun(
  pitchMidi: Float32Array,
  visit: (start: number, end: number) => void,
): void {
  let start = -1;
  for (let frame = 0; frame <= pitchMidi.length; frame++) {
    const voiced = frame < pitchMidi.length && isVoiced(pitchMidi[frame]!);
    if (voiced && start < 0) start = frame;
    if (!voiced && start >= 0) {
      visit(start, frame);
      start = -1;
    }
  }
}

function silenceEmptyFrames(melody: TrackedMelody): void {
  const { pitchMidi, dominance } = melody;
  for (let frame = 0; frame < pitchMidi.length; frame++) {
    if (isVoiced(pitchMidi[frame]!) && dominance[frame]! < MIN_FRAME_DOMINANCE) {
      pitchMidi[frame] = Number.NaN;
      dominance[frame] = 0;
    }
  }
}

function bridgeShortGaps(melody: TrackedMelody): void {
  const { pitchMidi, dominance } = melody;
  let lastVoiced = -1;
  for (let frame = 0; frame < pitchMidi.length; frame++) {
    if (!isVoiced(pitchMidi[frame]!)) continue;
    const gap = frame - lastVoiced - 1;
    if (lastVoiced >= 0 && gap > 0 && gap <= MAX_BRIDGED_GAP_FRAMES) {
      const before = pitchMidi[lastVoiced]!;
      const after = pitchMidi[frame]!;
      if (Math.abs(after - before) <= MAX_BRIDGED_PITCH_STEP) {
        const bridgedDominance = Math.min(dominance[lastVoiced]!, dominance[frame]!);
        for (let fill = lastVoiced + 1; fill < frame; fill++) {
          const mix = (fill - lastVoiced) / (gap + 1);
          pitchMidi[fill] = before + (after - before) * mix;
          dominance[fill] = bridgedDominance;
        }
      }
    }
    lastVoiced = frame;
  }
}

function medianFilterRuns(pitchMidi: Float32Array): void {
  const half = MEDIAN_WINDOW_FRAMES >> 1;
  const original = Float32Array.from(pitchMidi);
  const window: number[] = [];
  forEachVoicedRun(original, (start, end) => {
    for (let frame = start; frame < end; frame++) {
      window.length = 0;
      const from = Math.max(start, frame - half);
      const to = Math.min(end - 1, frame + half);
      for (let index = from; index <= to; index++) window.push(original[index]!);
      window.sort((a, b) => a - b);
      pitchMidi[frame] = window[window.length >> 1]!;
    }
  });
}

function removeUnconvincingRuns(melody: TrackedMelody, voicingThreshold: number): void {
  const { pitchMidi, dominance } = melody;
  forEachVoicedRun(Float32Array.from(pitchMidi), (start, end) => {
    let evidence = 0;
    for (let frame = start; frame < end; frame++) evidence += dominance[frame]! - voicingThreshold;
    if (end - start >= MIN_VOICED_RUN_FRAMES && evidence >= MIN_RUN_EVIDENCE) return;
    pitchMidi.fill(Number.NaN, start, end);
    dominance.fill(0, start, end);
  });
}

/** Cleans the melody in place. `voicingThreshold` is the one the melody was tracked with. */
export function cleanContour(melody: TrackedMelody, voicingThreshold: number): void {
  silenceEmptyFrames(melody);
  bridgeShortGaps(melody);
  medianFilterRuns(melody.pitchMidi);
  removeUnconvincingRuns(melody, voicingThreshold);
}
