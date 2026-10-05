// "Composer" half of the synthetic test-song generator: turns a seed and a few musical choices
// into a list of note events. Rendering to audio lives in renderSong.ts. Keeping the two apart
// lets the same song be rendered at different sample rates, levels or tunings.
import { SCALE_INTERVALS, type ScaleMode } from '@shared/music';
import { SeededRandom } from './random';

export type VocalRange = 'male' | 'female';

/**
 * How the melody's register moves from phrase to phrase:
 *  - 'steady': every phrase in the same octave-and-a-bit;
 *  - 'alternating': every second phrase an octave away (call and response, a duet);
 *  - 'section': the second half of the song an octave away (a chorus lifted an octave).
 */
export type PhraseRegister = 'steady' | 'alternating' | 'section';

export interface SongSpec {
  seed: number;
  durationSec: number;
  tempoBpm: number;
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  mode: ScaleMode;
  vocalRange: VocalRange;
  /** Scale degrees (0-based) of the chord played in each bar; repeated to fill the song. */
  progression?: readonly number[];
  phraseRegister?: PhraseRegister;
}

export interface VocalNote {
  startSec: number;
  endSec: number;
  midi: number;
  /** Index into the renderer's vowel table. */
  vowel: number;
  /** True when the note continues from the previous one without a gap (pitch glides over). */
  legato: boolean;
  /** Unvoiced lead-in (a "consonant") at the start of a non-legato note. */
  consonantSec: number;
  glideSec: number;
  /** Starts this many cents flat and slides up, as singers often do on phrase onsets. */
  scoopCents: number;
  /** How far off the singer is on this note. */
  intonationCents: number;
  vibratoHz: number;
  vibratoCents: number;
  /** True when silence follows this note. */
  phraseEnd: boolean;
}

export interface Breath {
  startSec: number;
  durationSec: number;
}

export interface ToneEvent {
  startSec: number;
  durationSec: number;
  midi: number;
  velocity: number;
  /** -1 = hard left, 0 = center, 1 = hard right. */
  pan: number;
}

export type DrumKind = 'kick' | 'snare' | 'hat';

export interface DrumHit {
  timeSec: number;
  kind: DrumKind;
  velocity: number;
}

export interface SongScore {
  spec: SongSpec;
  vocal: VocalNote[];
  breaths: Breath[];
  pads: ToneEvent[];
  arpeggio: ToneEvent[];
  bass: ToneEvent[];
  drums: DrumHit[];
  /**
   * A monophonic instrument line (a synth or keyboard "tune") in the vocal range, dead center.
   * Not part of the default arrangement; rendered with RenderOptions.includeLead.
   */
  lead: ToneEvent[];
}

const DEFAULT_PROGRESSIONS: Record<ScaleMode, readonly number[]> = {
  major: [0, 3, 4, 0],
  minor: [0, 3, 4, 0],
};

const VOCAL_CENTER_MIDI: Record<VocalRange, number> = { male: 52, female: 67 };
const VOCAL_SPAN_SEMITONES = 7;
/** The instrumental lead line plays around the A above middle C, between the two voices. */
const LEAD_CENTER_MIDI = 64;
/** Where the "other" register lies: a man's upper octave, a woman's lower one. */
const REGISTER_SHIFT_SEMITONES: Record<VocalRange, number> = { male: 12, female: -12 };
/** Pan position (as a magnitude) of the arpeggio notes, which alternate between the sides. */
export const ARPEGGIO_PAN = 0.6;
const BEATS_PER_BAR = 4;
const VOWEL_COUNT = 5;

function scalePitchClasses(tonic: number, mode: ScaleMode): number[] {
  return SCALE_INTERVALS[mode].map((interval) => (tonic + interval) % 12);
}

function chordPitchClasses(scale: readonly number[], degree: number): number[] {
  return [0, 2, 4].map((step) => scale[(degree + step) % scale.length]!);
}

/** Lowest MIDI note >= `floor` with the given pitch class. */
function midiAtOrAbove(pitchClass: number, floor: number): number {
  return floor + ((((pitchClass - floor) % 12) + 12) % 12);
}

function nearestIndex(values: readonly number[], target: number): number {
  let best = 0;
  for (let index = 1; index < values.length; index++) {
    if (Math.abs(values[index]! - target) < Math.abs(values[best]! - target)) best = index;
  }
  return best;
}

function composeVocal(
  spec: SongSpec,
  random: SeededRandom,
  beatSec: number,
  barCount: number,
): { notes: VocalNote[]; breaths: Breath[] } {
  const scale = scalePitchClasses(spec.tonic, spec.mode);
  const center = VOCAL_CENTER_MIDI[spec.vocalRange];
  const singable: number[] = [];
  for (let midi = center - VOCAL_SPAN_SEMITONES; midi <= center + VOCAL_SPAN_SEMITONES; midi++) {
    if (scale.includes(((midi % 12) + 12) % 12)) singable.push(midi);
  }
  const restingTones = [spec.tonic, scale[4]!, scale[2]!];

  const notes: VocalNote[] = [];
  const breaths: Breath[] = [];
  const songEndBeat = barCount * BEATS_PER_BAR;
  // Two bars of intro, and a two-bar instrumental break in the middle, without any singing.
  const breakStartBeat = Math.floor(barCount / 2) * BEATS_PER_BAR;
  const breakEndBeat = breakStartBeat + 2 * BEATS_PER_BAR;
  let beat = 2 * BEATS_PER_BAR;
  let scaleIndex = nearestIndex(singable, center);
  let phraseIndex = 0;

  while (beat < songEndBeat - BEATS_PER_BAR) {
    if (beat >= breakStartBeat && beat < breakEndBeat) {
      beat = breakEndBeat;
      continue;
    }
    const inOtherRegister =
      spec.phraseRegister === 'alternating'
        ? phraseIndex % 2 === 1
        : spec.phraseRegister === 'section' && beat >= breakStartBeat;
    const registerShift = inOtherRegister ? REGISTER_SHIFT_SEMITONES[spec.vocalRange] : 0;
    phraseIndex++;
    const phraseNoteCount = random.integer(4, 8);
    for (let position = 0; position < phraseNoteCount; position++) {
      const isLast = position === phraseNoteCount - 1;
      const previous = position > 0 ? notes[notes.length - 1] : undefined;
      let beats = random.pick([0.5, 0.5, 1, 1, 1, 1.5, 2]);
      let midi: number;
      if (isLast) {
        beats = random.pick([2, 2, 3]);
        const restingClass = random.pick([
          restingTones[0]!,
          restingTones[0]!,
          restingTones[0]!,
          restingTones[1]!,
          restingTones[2]!,
        ]);
        const candidates = singable.filter((note) => ((note % 12) + 12) % 12 === restingClass);
        const current = singable[scaleIndex]!;
        midi = candidates[nearestIndex(candidates, current)]!;
        scaleIndex = singable.indexOf(midi);
      } else {
        const stepChoice = random.next();
        let step: number;
        if (stepChoice < 0.6) step = random.chance(0.5) ? 1 : -1;
        else if (stepChoice < 0.85) step = random.chance(0.5) ? 2 : -2;
        else if (stepChoice < 0.93) step = 0;
        else step = random.chance(0.5) ? 4 : -4;
        if (position === 0) step = random.integer(-2, 2);
        let nextIndex = scaleIndex + step;
        if (nextIndex < 0 || nextIndex >= singable.length) nextIndex = scaleIndex - step;
        scaleIndex = Math.min(singable.length - 1, Math.max(0, nextIndex));
        midi = singable[scaleIndex]!;
      }
      midi += registerShift;

      // A repeated pitch can only be heard as a new note when it is re-articulated.
      const repeatsPitch = previous !== undefined && previous.midi === midi;
      const legato = previous !== undefined && !repeatsPitch && random.chance(0.7);
      const startSec = beat * beatSec;
      const durationSec = beats * beatSec;
      const longEnoughForVibrato = durationSec >= 0.45;
      notes.push({
        startSec,
        endSec: startSec + durationSec,
        midi,
        vowel: random.integer(0, VOWEL_COUNT - 1),
        legato,
        consonantSec: legato ? 0 : previous === undefined ? 0 : random.range(0.04, 0.07),
        glideSec: random.range(0.04, 0.07),
        scoopCents: !legato && random.chance(0.4) ? random.range(30, 70) : 0,
        intonationCents: Math.max(-20, Math.min(20, random.gaussian() * 8)),
        vibratoHz: random.range(5, 6.5),
        vibratoCents: longEnoughForVibrato ? random.range(25, 60) : 0,
        phraseEnd: isLast,
      });
      beat += beats;
    }
    const lastNote = notes[notes.length - 1]!;
    const restBeats = random.pick([1.5, 2, 2.5, 3]);
    breaths.push({ startSec: lastNote.endSec + 0.12, durationSec: random.range(0.2, 0.3) });
    // Phrases start on a half-beat grid so the vocal is not locked to the drums.
    beat = Math.ceil((beat + restBeats) * 2) / 2;
  }

  // Drop anything that would run past the end of the song.
  const limitSec = spec.durationSec - 0.3;
  const kept = notes.filter((note) => note.endSec <= limitSec);
  const lastKept = kept[kept.length - 1];
  if (lastKept) lastKept.phraseEnd = true;
  return { notes: kept, breaths: breaths.filter((breath) => breath.startSec < limitSec - 0.4) };
}

function composeAccompaniment(
  spec: SongSpec,
  random: SeededRandom,
  beatSec: number,
  barCount: number,
): Pick<SongScore, 'pads' | 'arpeggio' | 'bass' | 'drums'> {
  const scale = scalePitchClasses(spec.tonic, spec.mode);
  const progression = spec.progression ?? DEFAULT_PROGRESSIONS[spec.mode];
  const pads: ToneEvent[] = [];
  const arpeggio: ToneEvent[] = [];
  const bass: ToneEvent[] = [];
  const drums: DrumHit[] = [];

  for (let bar = 0; bar < barCount; bar++) {
    const barStart = bar * BEATS_PER_BAR * beatSec;
    const degree = progression[bar % progression.length]!;
    const chord = chordPitchClasses(scale, degree);
    const root = chord[0]!;
    const fifth = chord[2]!;

    // Pad: the triad held for the whole bar, in the octave around middle C.
    for (const pitchClass of chord) {
      pads.push({
        startSec: barStart,
        durationSec: BEATS_PER_BAR * beatSec,
        midi: midiAtOrAbove(pitchClass, 55),
        velocity: random.range(0.8, 1),
        pan: 0,
      });
    }

    // Arpeggio: eighth notes through the chord tones an octave higher, alternating sides.
    const arpNotes = chord.map((pitchClass) => midiAtOrAbove(pitchClass, 67));
    for (let eighth = 0; eighth < BEATS_PER_BAR * 2; eighth++) {
      if (random.chance(0.12)) continue;
      arpeggio.push({
        startSec: barStart + eighth * 0.5 * beatSec,
        durationSec: 0.5 * beatSec,
        midi: random.pick(arpNotes),
        velocity: random.range(0.55, 1),
        pan: eighth % 2 === 0 ? -ARPEGGIO_PAN : ARPEGGIO_PAN,
      });
    }

    // Bass: roots (sometimes the fifth) one to two octaves below the singer, dead center.
    const bassPattern: readonly [number, number][] = [
      [0, 1.5],
      [1.5, 0.5],
      [2, 1],
      [3, 1],
    ];
    for (const [beatOffset, beats] of bassPattern) {
      if (beatOffset > 0 && random.chance(0.15)) continue;
      const pitchClass = beatOffset > 0 && random.chance(0.25) ? fifth : root;
      bass.push({
        startSec: barStart + beatOffset * beatSec,
        durationSec: beats * beatSec * 0.95,
        midi: midiAtOrAbove(pitchClass, 33),
        velocity: random.range(0.75, 1),
        pan: 0,
      });
    }

    // Drums: kick on 1 and 3, snare on 2 and 4, hats on the eighths, with human-like variation
    // and occasional fills so that no two bars are exactly alike.
    for (let beatIndex = 0; beatIndex < BEATS_PER_BAR; beatIndex++) {
      const beatTime = barStart + beatIndex * beatSec;
      const kind: DrumKind = beatIndex % 2 === 0 ? 'kick' : 'snare';
      drums.push({ timeSec: beatTime, kind, velocity: random.range(0.75, 1) });
      if (kind === 'kick' && random.chance(0.25)) {
        drums.push({
          timeSec: beatTime + 0.5 * beatSec,
          kind: 'kick',
          velocity: random.range(0.5, 0.8),
        });
      }
      for (let half = 0; half < 2; half++) {
        if (random.chance(0.08)) continue;
        drums.push({
          timeSec: beatTime + half * 0.5 * beatSec,
          kind: 'hat',
          velocity: (half === 0 ? 0.9 : 0.55) * random.range(0.7, 1),
        });
      }
    }
    if (bar % 4 === 3 && random.chance(0.6)) {
      const fillStart = barStart + 3 * beatSec;
      for (let sixteenth = 1; sixteenth < 4; sixteenth++) {
        if (random.chance(0.3)) continue;
        drums.push({
          timeSec: fillStart + sixteenth * 0.25 * beatSec,
          kind: 'snare',
          velocity: random.range(0.5, 0.9),
        });
      }
    }
  }
  return { pads, arpeggio, bass, drums };
}

/**
 * An instrumental tune over the whole song: mostly stepwise through the scale, landing on chord
 * tones, in two-bar phrases with short rests. Everything a sung melody is, except sung.
 */
function composeLead(
  spec: SongSpec,
  random: SeededRandom,
  beatSec: number,
  barCount: number,
): ToneEvent[] {
  const scale = scalePitchClasses(spec.tonic, spec.mode);
  const center = LEAD_CENTER_MIDI;
  const playable: number[] = [];
  for (let midi = center - VOCAL_SPAN_SEMITONES; midi <= center + VOCAL_SPAN_SEMITONES; midi++) {
    if (scale.includes(((midi % 12) + 12) % 12)) playable.push(midi);
  }
  const lead: ToneEvent[] = [];
  const songEndBeat = barCount * BEATS_PER_BAR;
  let index = nearestIndex(playable, center);
  let beat = 0;
  while (beat < songEndBeat - 1) {
    const phraseEndBeat = Math.min(songEndBeat, beat + 2 * BEATS_PER_BAR - 1);
    while (beat < phraseEndBeat) {
      const beats = Math.min(phraseEndBeat - beat, random.pick([0.5, 0.5, 1, 1, 1.5, 2]));
      const step = random.pick([-2, -1, -1, 0, 1, 1, 2]);
      index = Math.min(playable.length - 1, Math.max(0, index + step));
      lead.push({
        startSec: beat * beatSec,
        durationSec: beats * beatSec * 0.92,
        midi: playable[index]!,
        velocity: random.range(0.8, 1),
        pan: 0,
      });
      beat += beats;
    }
    beat = phraseEndBeat + 1;
  }
  return lead;
}

/**
 * Deterministically composes a short pop-like song: sung melody, pad, arpeggio, bass, drums,
 * and an optional instrumental lead line.
 */
export function composeSong(spec: SongSpec): SongScore {
  const random = new SeededRandom(spec.seed);
  const beatSec = 60 / spec.tempoBpm;
  const barCount = Math.floor(spec.durationSec / (BEATS_PER_BAR * beatSec));
  const vocal = composeVocal(spec, random, beatSec, barCount);
  const accompaniment = composeAccompaniment(spec, random, beatSec, barCount);
  // Its own random stream, so the rest of the song is the same with or without it.
  const lead = composeLead(spec, new SeededRandom(spec.seed ^ 0x2c1b3c6d), beatSec, barCount);
  return { spec, vocal: vocal.notes, breaths: vocal.breaths, ...accompaniment, lead };
}
