// Chooses one melody path through the per-frame pitch candidates (Viterbi decoding).
import { CANDIDATES_PER_FRAME } from './salience';

/** Per-frame melody candidates, `CANDIDATES_PER_FRAME` slots per frame, strongest first. */
export interface MelodyCandidates {
  frameCount: number;
  /** Fractional MIDI pitch per slot. */
  pitchMidi: Float32Array;
  /** Harmonic-summation salience per slot; 0 marks an empty slot. */
  salience: Float32Array;
  /** Harmonic dominance per slot, 0..1 (see harmonicDominance.ts). */
  dominance: Float32Array;
}

export interface TrackedMelody {
  /** Fractional MIDI pitch per frame; NaN where no lead vocal was found. */
  pitchMidi: Float32Array;
  /** Harmonic dominance of the chosen candidate; 0 on unvoiced frames. */
  dominance: Float32Array;
}

export function createMelodyCandidates(frameCount: number): MelodyCandidates {
  const slots = frameCount * CANDIDATES_PER_FRAME;
  return {
    frameCount,
    pitchMidi: new Float32Array(slots),
    salience: new Float32Array(slots),
    dominance: new Float32Array(slots),
  };
}

// Path score = sum over voiced frames of (dominance - voicing threshold - penalties) minus
// transition costs; unvoiced frames score 0. All costs are therefore in units of "dominance
// per frame": a cost of 0.6 is paid off by six frames that are 0.1 above the threshold.

/**
 * Entering or leaving the voiced state. Makes the decision sticky: a note is not cut by a
 * drum hit, and one stray frame does not start a note.
 */
const VOICING_SWITCH_COST = 0.6;
/**
 * Cost of following a candidate with no salience at all instead of the frame's most salient
 * one; scaled linearly in between. Decides between octave relatives, whose dominance is equal.
 */
const RIVAL_PENALTY = 0.6;
/** Pitch movement per frame (semitones) that is free: vibrato and glides move this fast. */
const FREE_MOVEMENT_SEMITONES = 0.4;
const JUMP_COST_PER_SEMITONE = 0.12;
/** Large leaps all cost the same: melodies do jump, and a new note may start anywhere. */
const MAX_JUMP_COST = 1.0;
/**
 * Width (standard deviation, semitones) of the register preference used in the second pass.
 * A sung phrase mostly stays within an octave or so of its own centre.
 */
const REGISTER_SPREAD_SEMITONES = 9;
/**
 * First-pass voiced stretches closer than this form one phrase with one register. Phrases are
 * separated by breaths and rests that are longer than this; consonants and drum hits are not.
 */
const REGISTER_PHRASE_GAP_SEC = 0.4;
/** The phrase's register also applies this far before and after it (onsets, late releases). */
const REGISTER_MARGIN_SEC = 0.2;

const UNVOICED = CANDIDATES_PER_FRAME;
const STATE_COUNT = CANDIDATES_PER_FRAME + 1;

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
}

/**
 * The register of the phrase around each frame: the median pitch of the first pass's voiced
 * frames in that phrase; NaN (no preference) away from any phrase. Returns null when nothing
 * is voiced at all.
 *
 * Phrase by phrase, not over a longer window: songs move between registers from one phrase to
 * the next (call and response, a duet, a chorus lifted an octave), and a register taken from
 * the neighbouring phrases would pull a whole phrase into the wrong octave. A wrong note inside
 * a phrase is outvoted by the phrase's other notes, which is the error this pass repairs.
 */
function estimateRegister(pitchMidi: Float32Array, hopSec: number): Float32Array | null {
  const frameCount = pitchMidi.length;
  const register = new Float32Array(frameCount).fill(Number.NaN);
  const maxGap = Math.round(REGISTER_PHRASE_GAP_SEC / hopSec);
  const margin = Math.round(REGISTER_MARGIN_SEC / hopSec);
  const phrase: number[] = [];
  let phraseStart = -1;
  let lastVoiced = -1;
  let anyVoiced = false;

  const closePhrase = () => {
    if (phrase.length === 0) return;
    // Phrases are more than two margins apart, so the filled spans never overlap.
    const from = Math.max(0, phraseStart - margin);
    const to = Math.min(frameCount, lastVoiced + 1 + margin);
    register.fill(median(phrase), from, to);
    phrase.length = 0;
  };

  for (let frame = 0; frame < frameCount; frame++) {
    const pitch = pitchMidi[frame]!;
    if (Number.isNaN(pitch)) continue;
    anyVoiced = true;
    if (phrase.length > 0 && frame - lastVoiced > maxGap) closePhrase();
    if (phrase.length === 0) phraseStart = frame;
    phrase.push(pitch);
    lastVoiced = frame;
  }
  closePhrase();
  return anyVoiced ? register : null;
}

function decodePath(
  candidates: MelodyCandidates,
  register: Float32Array | null,
  voicingThreshold: number,
): TrackedMelody {
  const { frameCount } = candidates;
  const pitchMidi = new Float32Array(frameCount).fill(Number.NaN);
  const dominance = new Float32Array(frameCount);
  if (frameCount === 0) return { pitchMidi, dominance };

  const backPointer = new Uint8Array(frameCount * STATE_COUNT);
  let previousScore = new Float64Array(STATE_COUNT).fill(Number.NEGATIVE_INFINITY);
  let score = new Float64Array(STATE_COUNT);
  const weightedSalience = new Float64Array(CANDIDATES_PER_FRAME);
  previousScore[UNVOICED] = 0;

  for (let frame = 0; frame < frameCount; frame++) {
    const base = frame * CANDIDATES_PER_FRAME;
    const previousBase = base - CANDIDATES_PER_FRAME;

    // Salience as seen from the register: candidates far from where the melody has been moving
    // count for less when the frame's candidates are ranked against each other. This only
    // re-ranks rivals; it never makes a lone candidate less likely to be voiced.
    let strongest = 0;
    for (let slot = 0; slot < CANDIDATES_PER_FRAME; slot++) {
      let weighted = candidates.salience[base + slot]!;
      const center = register ? register[frame]! : Number.NaN;
      if (!Number.isNaN(center) && weighted > 0) {
        const distance = (candidates.pitchMidi[base + slot]! - center) / REGISTER_SPREAD_SEMITONES;
        weighted *= Math.exp(-0.5 * distance * distance);
      }
      weightedSalience[slot] = weighted;
      if (weighted > strongest) strongest = weighted;
    }

    for (let slot = 0; slot < CANDIDATES_PER_FRAME; slot++) {
      if (candidates.salience[base + slot]! <= 0) {
        score[slot] = Number.NEGATIVE_INFINITY;
        continue;
      }
      const pitch = candidates.pitchMidi[base + slot]!;
      const emission =
        candidates.dominance[base + slot]! -
        voicingThreshold -
        RIVAL_PENALTY * (1 - weightedSalience[slot]! / strongest);

      let best = previousScore[UNVOICED]! - VOICING_SWITCH_COST;
      let bestState = UNVOICED;
      if (frame > 0) {
        for (let from = 0; from < CANDIDATES_PER_FRAME; from++) {
          const fromScore = previousScore[from]!;
          if (fromScore === Number.NEGATIVE_INFINITY) continue;
          const jump = Math.abs(pitch - candidates.pitchMidi[previousBase + from]!);
          const cost = Math.min(
            MAX_JUMP_COST,
            Math.max(0, jump - FREE_MOVEMENT_SEMITONES) * JUMP_COST_PER_SEMITONE,
          );
          if (fromScore - cost > best) {
            best = fromScore - cost;
            bestState = from;
          }
        }
      }
      score[slot] = best + emission;
      backPointer[frame * STATE_COUNT + slot] = bestState;
    }

    let bestSilent = previousScore[UNVOICED]!;
    let bestSilentState = UNVOICED;
    for (let from = 0; from < CANDIDATES_PER_FRAME; from++) {
      const candidateScore = previousScore[from]! - VOICING_SWITCH_COST;
      if (candidateScore > bestSilent) {
        bestSilent = candidateScore;
        bestSilentState = from;
      }
    }
    score[UNVOICED] = bestSilent;
    backPointer[frame * STATE_COUNT + UNVOICED] = bestSilentState;

    [previousScore, score] = [score, previousScore];
  }

  let state = UNVOICED;
  for (let candidate = 0; candidate < STATE_COUNT; candidate++) {
    if (previousScore[candidate]! > previousScore[state]!) state = candidate;
  }
  for (let frame = frameCount - 1; frame >= 0; frame--) {
    if (state !== UNVOICED) {
      const index = frame * CANDIDATES_PER_FRAME + state;
      pitchMidi[frame] = candidates.pitchMidi[index]!;
      dominance[frame] = candidates.dominance[index]!;
    }
    state = backPointer[frame * STATE_COUNT + state]!;
  }
  return { pitchMidi, dominance };
}

/**
 * Two passes: the first finds the melody from the per-frame evidence alone; the second repeats
 * the search with a mild preference for the register of the phrase the first pass found around
 * each frame. Whole notes an octave or a twelfth off are the typical error of harmonic
 * summation, and the wrong octave is just as smooth a path as the right one, so only the
 * phrase's context can tell them apart (this is the octave-error repair step).
 */
export function trackMelody(
  candidates: MelodyCandidates,
  hopSec: number,
  voicingThreshold: number,
): TrackedMelody {
  const firstPass = decodePath(candidates, null, voicingThreshold);
  const register = estimateRegister(firstPass.pitchMidi, hopSec);
  return register ? decodePath(candidates, register, voicingThreshold) : firstPass;
}
