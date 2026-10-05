// Tells sung phrases from instrument lines by how the pitch moves.
//
// Harmonic dominance in the centre of the stereo image only says "one harmonic source holds
// most of the vocal band". A centred piano, pad, bass line or synth lead passes that test as
// well as a voice does, and in a mono or narrow mix nothing else is left to tell them apart.
// The pitch contour can: a voice never holds still. Vibrato, scoops into notes, glides between
// them and drift keep a sung pitch moving by several cents every 10 ms for a large part of any
// phrase, while keyboards, pads, fretted bass and most synths hold each note perfectly steady
// and change notes in one step (the contour features behind Melodia's voicing decision,
// Salamon & Gomez 2012).
//
// Measured on the synthetic test songs (median-filtered contour, see contourCleanup.ts): sung
// phrases move on 33-65 % of their frames; accompaniment tracked in every tested layout (wide,
// narrowed, centred pads or arpeggio, centred synth lead, mono) on 0-19 %, with one 0.6 s
// outlier at 39 %. Bass lines are the exception, see MIN_LEAD_PHRASE_MIDI.
import { MIN_VOICED_RUN_FRAMES, forEachVoicedRun } from './contourCleanup';
import type { TrackedMelody } from './melodyTracker';

/**
 * Voiced stretches closer than this belong to one phrase and are judged together: a sung
 * phrase is broken up by consonants and drum hits, and its short notes alone may be steady.
 */
const PHRASE_GAP_FRAMES = 25;
/**
 * Pitch change per frame (semitones) that counts as "moving": 3 cents per 10 ms. Vibrato of +/-20 cents at 5.5 Hz exceeds it on three quarters of its frames; the
 * estimation noise left on a steady tone after median filtering stays well below it.
 */
const MIN_MOVEMENT_PER_FRAME = 0.03;
/** A step larger than this between frames is a jump between notes, which instruments make too. */
const MAX_MOVEMENT_PER_FRAME = 0.8;
/** Share of a phrase's frames that must be moving for the phrase to count as sung. */
const MIN_MOVING_SHARE = 0.25;
/**
 * A note held this long without moving is an instrument even inside a sung phrase: in a mono
 * or narrow mix the tracker can slide from the end of a sung note onto a held chord or bass
 * note. Sung notes this long carry vibrato or at least drift; shorter ones may be steady.
 */
const MIN_HELD_NOTE_FRAMES = 50;
/** Moving share below which such a held note counts as steady. */
const MAX_HELD_NOTE_MOVING_SHARE = 0.1;
/**
 * Phrases centred below A2 (110 Hz) are bass lines, not lead vocals. Down there the frequency
 * resolution is coarse and the kick drum interferes, so a steady bass note's estimated pitch
 * jitters enough to pass for a moving voice; the register is the safer test.
 */
const MIN_LEAD_PHRASE_MIDI = 45;

export interface VoiceLikenessResult {
  /** Voiced frames removed because they behaved like an instrument, not a voice. */
  rejectedFrames: number;
  /** Voiced frames kept. */
  keptFrames: number;
}

function isVoiced(pitch: number): boolean {
  return !Number.isNaN(pitch);
}

/**
 * Share of the span's inner voiced frames whose pitch is gliding or modulating: moving by at
 * least MIN_MOVEMENT_PER_FRAME (central difference) without a jump on either side.
 */
export function movingShare(pitchMidi: Float32Array, start: number, end: number): number {
  let inner = 0;
  let moving = 0;
  for (let frame = start + 1; frame < end - 1; frame++) {
    const pitch = pitchMidi[frame]!;
    const before = pitchMidi[frame - 1]!;
    const after = pitchMidi[frame + 1]!;
    if (!isVoiced(pitch) || !isVoiced(before) || !isVoiced(after)) continue;
    inner++;
    const nextToJump =
      Math.abs(pitch - before) > MAX_MOVEMENT_PER_FRAME ||
      Math.abs(after - pitch) > MAX_MOVEMENT_PER_FRAME;
    if (!nextToJump && 0.5 * Math.abs(after - before) >= MIN_MOVEMENT_PER_FRAME) moving++;
  }
  return inner > 0 ? moving / inner : 0;
}

/** Calls `visit(start, end)` for every phrase: voiced runs joined across short gaps. */
function forEachPhrase(pitchMidi: Float32Array, visit: (start: number, end: number) => void) {
  let phraseStart = -1;
  let phraseEnd = -1;
  forEachVoicedRun(pitchMidi, (start, end) => {
    if (phraseStart >= 0 && start - phraseEnd <= PHRASE_GAP_FRAMES) {
      phraseEnd = end;
      return;
    }
    if (phraseStart >= 0) visit(phraseStart, phraseEnd);
    phraseStart = start;
    phraseEnd = end;
  });
  if (phraseStart >= 0) visit(phraseStart, phraseEnd);
}

/** Calls `visit(start, end)` for every stretch of a run without a jump between notes. */
function forEachSegment(
  pitchMidi: Float32Array,
  runStart: number,
  runEnd: number,
  visit: (start: number, end: number) => void,
) {
  let start = runStart;
  for (let frame = runStart + 1; frame <= runEnd; frame++) {
    const jump =
      frame < runEnd &&
      Math.abs(pitchMidi[frame]! - pitchMidi[frame - 1]!) > MAX_MOVEMENT_PER_FRAME;
    if (frame === runEnd || jump) {
      visit(start, frame);
      start = frame;
    }
  }
}

function medianVoicedPitch(pitchMidi: Float32Array, start: number, end: number): number {
  const voiced: number[] = [];
  for (let frame = start; frame < end; frame++) {
    if (isVoiced(pitchMidi[frame]!)) voiced.push(pitchMidi[frame]!);
  }
  voiced.sort((a, b) => a - b);
  return voiced[voiced.length >> 1] ?? Number.NaN;
}

/**
 * Removes (in place) everything that holds as still as an instrument: long held notes, then
 * whole phrases that do not move like a voice or sit in the bass register.
 */
export function keepVoiceLikePhrases(melody: TrackedMelody): VoiceLikenessResult {
  const { pitchMidi, dominance } = melody;
  let voicedBefore = 0;
  for (const pitch of pitchMidi) if (isVoiced(pitch)) voicedBefore++;
  const silence = (start: number, end: number) => {
    pitchMidi.fill(Number.NaN, start, end);
    dominance.fill(0, start, end);
  };

  forEachVoicedRun(Float32Array.from(pitchMidi), (runStart, runEnd) => {
    forEachSegment(pitchMidi, runStart, runEnd, (start, end) => {
      const held = end - start >= MIN_HELD_NOTE_FRAMES;
      if (held && movingShare(pitchMidi, start, end) < MAX_HELD_NOTE_MOVING_SHARE) {
        silence(start, end);
      }
    });
  });
  // What is left between removed held notes may be a few frames of a glide: not a note.
  forEachVoicedRun(Float32Array.from(pitchMidi), (start, end) => {
    if (end - start < MIN_VOICED_RUN_FRAMES) silence(start, end);
  });
  forEachPhrase(Float32Array.from(pitchMidi), (start, end) => {
    const sung =
      movingShare(pitchMidi, start, end) >= MIN_MOVING_SHARE &&
      medianVoicedPitch(pitchMidi, start, end) >= MIN_LEAD_PHRASE_MIDI;
    if (!sung) silence(start, end);
  });

  let keptFrames = 0;
  for (const pitch of pitchMidi) if (isVoiced(pitch)) keptFrames++;
  return { rejectedFrames: voicedBefore - keptFrames, keptFrames };
}
