// "Performer" half of the synthetic test-song generator: renders a SongScore to stereo audio
// together with the ground truth the analysis is tested against.
//
// The song is deliberately awkward for a melody extractor: the voice has formants (so the
// fundamental is often not its strongest partial), vibrato, glides, scoops, consonant gaps and
// breaths; the bass sits one to two octaves below it in the same key and dead center; the pad
// and arpeggio overlap the vocal range; the snare is broadband noise in the center.
import type { ScaleMode } from '@shared/music';
import { midiToHz } from '@shared/music';
import type { StereoPcm } from '../types';
import { SeededRandom } from './random';
import type { DrumHit, SongScore, ToneEvent, VocalNote } from './songScore';

export interface RenderOptions {
  sampleRate: number;
  /** Vocal level relative to the complete accompaniment while singing, in dB (0 = equally loud). */
  vocalGainDb: number;
  /** Detunes the whole song (voice and instruments) from A = 440 Hz. */
  tuningCents?: number;
  /** Adds a decorrelated stereo reverb tail to the voice. */
  reverb?: boolean;
  includeVocal?: boolean;
  /**
   * Adds the score's instrumental lead line (a steady synth tune in the vocal range, dead
   * centre) to the accompaniment: everything a sung melody is, except sung.
   */
  includeLead?: boolean;
  /** RMS level of each accompaniment stem in dB relative to the default balance; null mutes it. */
  stemLevelsDb?: Partial<Record<StemName, number | null>>;
  /**
   * Stereo width per stem: its side signal (L-R)/2 is scaled by this factor, so 0 collapses
   * the stem to the centre (a "wide" pad becomes a mono, chorused pad) and 1 keeps the
   * arrangement's own image. Multiplied by `accompanimentWidth`.
   */
  stemWidths?: Partial<Record<StemName, number>>;
  /** The same for the whole accompaniment at once (mastering-style width control). */
  accompanimentWidth?: number;
}

export type StemName = 'pads' | 'arpeggio' | 'bass' | 'drums' | 'lead';

/** Default balance: pad and bass equally loud, arpeggio and drums a little behind. */
const DEFAULT_STEM_LEVELS_DB: Record<StemName, number> = {
  pads: 0,
  arpeggio: -3,
  bass: 0,
  drums: -2,
  lead: 0,
};

export interface TruthNote {
  startSec: number;
  endSec: number;
  midi: number;
}

export interface SongTruth {
  /** Seconds between ground-truth frames. */
  hopSec: number;
  /** Sung fundamental per frame in Hz; 0 where nobody is singing. */
  f0Hz: Float32Array;
  notes: TruthNote[];
  key: { tonic: number; mode: ScaleMode };
  tuningCents: number;
}

export interface RenderedSong {
  /** Full mix: voice + accompaniment. */
  mix: StereoPcm;
  /** The same performance without the voice (a "karaoke" version), at the same level. */
  instrumental: StereoPcm;
  truth: SongTruth;
}

export const TRUTH_HOP_SEC = 0.01;

/**
 * Formant frequencies and bandwidths (Hz) of five sung vowels: a, e, i, o, u. The vocal tract
 * is modelled the classic way, as a cascade of two-pole resonators, which gives realistic
 * peaks AND realistic valleys between the formants.
 */
const VOWELS: readonly (readonly [number, number][])[] = [
  [
    [730, 90],
    [1090, 110],
    [2440, 170],
    [3400, 250],
  ],
  [
    [530, 70],
    [1840, 110],
    [2480, 170],
    [3400, 250],
  ],
  [
    [270, 60],
    [2290, 100],
    [3010, 150],
    [3500, 250],
  ],
  [
    [570, 80],
    [840, 100],
    [2410, 170],
    [3400, 250],
  ],
  [
    [300, 60],
    [870, 100],
    [2240, 150],
    [3400, 250],
  ],
];

const MAX_VOCAL_HARMONICS = 60;
const VOCAL_BANDWIDTH_HZ = 10_000;
const VOICED_GAIN_THRESHOLD = 0.3;

function tuned(midi: number, tuningCents: number): number {
  return midiToHz(midi + tuningCents / 100);
}

function smoothStep(x: number): number {
  const clamped = Math.min(1, Math.max(0, x));
  return 0.5 - 0.5 * Math.cos(Math.PI * clamped);
}

function formantGain(vowelIndex: number, frequencyHz: number): number {
  let gain = 1;
  for (const [center, bandwidth] of VOWELS[vowelIndex % VOWELS.length]!) {
    const detune = center * center - frequencyHz * frequencyHz;
    gain *= (center * center) / Math.sqrt(detune * detune + (bandwidth * frequencyHz) ** 2);
  }
  return gain;
}

interface VocalControl {
  /** Instantaneous fundamental per sample in Hz. */
  f0: Float32Array;
  /** Amplitude envelope per sample, 0..1. */
  gain: Float32Array;
  vowel: Uint8Array;
}

function buildVocalControl(
  notes: readonly VocalNote[],
  sampleCount: number,
  sampleRate: number,
  tuningCents: number,
  random: SeededRandom,
): VocalControl {
  const f0 = new Float32Array(sampleCount);
  const gain = new Float32Array(sampleCount);
  const vowel = new Uint8Array(sampleCount);
  const attackSec = 0.025;
  const releaseSec = 0.04;
  const driftPhaseA = random.range(0, 2 * Math.PI);
  const driftPhaseB = random.range(0, 2 * Math.PI);

  notes.forEach((note, index) => {
    const previous = note.legato ? notes[index - 1] : undefined;
    const next = notes[index + 1];
    const continuesIntoNext = next !== undefined && next.legato;
    const voicedStart = note.startSec + note.consonantSec;
    const voicedEnd = note.endSec;
    const targetMidi = note.midi + (tuningCents + note.intonationCents) / 100;
    const previousMidi =
      previous !== undefined
        ? previous.midi + (tuningCents + previous.intonationCents) / 100
        : targetMidi;

    const firstSample = Math.max(0, Math.round(voicedStart * sampleRate));
    const lastSample = Math.min(sampleCount, Math.round(voicedEnd * sampleRate));
    for (let n = firstSample; n < lastSample; n++) {
      const time = n / sampleRate;
      const sinceStart = time - voicedStart;
      let midi = targetMidi;
      if (previous !== undefined) {
        midi = previousMidi + (targetMidi - previousMidi) * smoothStep(sinceStart / note.glideSec);
      } else if (note.scoopCents > 0) {
        midi -= (note.scoopCents / 100) * (1 - smoothStep(sinceStart / 0.07));
      }
      const vibratoDepth = note.vibratoCents * smoothStep((sinceStart - 0.15) / 0.15);
      midi += (vibratoDepth / 100) * Math.sin(2 * Math.PI * note.vibratoHz * sinceStart);
      // Slow wander of a few cents, as no human holds a perfectly steady pitch.
      midi +=
        0.04 * Math.sin(2 * Math.PI * 0.7 * time + driftPhaseA) +
        0.03 * Math.sin(2 * Math.PI * 1.9 * time + driftPhaseB);

      let envelope = 1;
      if (previous === undefined) envelope = Math.min(envelope, sinceStart / attackSec);
      if (!continuesIntoNext) envelope = Math.min(envelope, (voicedEnd - time) / releaseSec);
      f0[n] = midiToHz(midi);
      gain[n] = Math.max(0, envelope);
      vowel[n] = note.vowel;
    }
  });
  return { f0, gain, vowel };
}

/**
 * Additive voice: harmonics with the -6 dB/octave tilt of a glottal source after lip radiation,
 * shaped by the current vowel's formants.
 */
function renderVoice(
  control: VocalControl,
  sampleRate: number,
  random: SeededRandom,
): Float32Array {
  const sampleCount = control.f0.length;
  const output = new Float32Array(sampleCount);
  const amplitudes = new Float64Array(MAX_VOCAL_HARMONICS + 1);
  const targets = new Float64Array(MAX_VOCAL_HARMONICS + 1);
  const controlBlock = 32;
  // Timbre follows vowel and pitch changes with a ~10 ms lag, like a moving mouth.
  const smoothing = 1 - Math.exp(-controlBlock / (0.01 * sampleRate));
  const bandLimitHz = Math.min(VOCAL_BANDWIDTH_HZ, 0.45 * sampleRate);
  let phase = 0;
  let harmonicCount = 0;
  let sounding = false;

  for (let n = 0; n < sampleCount; n++) {
    const envelope = control.gain[n]!;
    if (envelope <= 0) {
      sounding = false;
      continue;
    }
    const frequency = control.f0[n]!;
    if (n % controlBlock === 0 || !sounding) {
      harmonicCount = Math.min(MAX_VOCAL_HARMONICS, Math.floor(bandLimitHz / frequency));
      let power = 0;
      for (let h = 1; h <= harmonicCount; h++) {
        const amplitude = formantGain(control.vowel[n]!, h * frequency) / h;
        targets[h] = amplitude;
        power += amplitude * amplitude;
      }
      const normalizer = 1 / Math.sqrt(power);
      for (let h = 1; h <= MAX_VOCAL_HARMONICS; h++) {
        const target = h <= harmonicCount ? targets[h]! * normalizer : 0;
        // A note starting from silence begins with its own timbre; otherwise glide toward it.
        amplitudes[h] = sounding ? amplitudes[h]! + (target - amplitudes[h]!) * smoothing : target;
      }
      sounding = true;
    }
    phase += (2 * Math.PI * frequency) / sampleRate;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;

    // sin(h*phase) for h = 1, 2, 3... by the Chebyshev recurrence.
    const twoCos = 2 * Math.cos(phase);
    let previousSine = 0;
    let currentSine = Math.sin(phase);
    let sample = 0;
    for (let h = 1; h <= harmonicCount; h++) {
      sample += amplitudes[h]! * currentSine;
      const nextSine = twoCos * currentSine - previousSine;
      previousSine = currentSine;
      currentSine = nextSine;
    }
    const aspiration = 0.02 * random.noise();
    output[n] = envelope * (sample + aspiration);
  }
  return output;
}

function addBreaths(
  output: Float32Array,
  breaths: readonly { startSec: number; durationSec: number }[],
  sampleRate: number,
  random: SeededRandom,
): void {
  for (const breath of breaths) {
    const first = Math.round(breath.startSec * sampleRate);
    const length = Math.round(breath.durationSec * sampleRate);
    let lowPassed = 0;
    let slower = 0;
    for (let i = 0; i < length && first + i < output.length; i++) {
      // Band-passed noise (difference of two one-pole low-passes), roughly 1-4 kHz.
      const white = random.noise();
      lowPassed += 0.45 * (white - lowPassed);
      slower += 0.12 * (white - slower);
      const envelope = Math.sin((Math.PI * i) / length) ** 2;
      output[first + i]! += 0.12 * envelope * (lowPassed - slower);
    }
  }
}

/** Small Schroeder-style reverb; different delay sets left and right decorrelate the tail. */
function reverbTail(
  dry: Float32Array,
  sampleRate: number,
  delaysMs: readonly number[],
): Float32Array {
  const wet = new Float32Array(dry.length);
  for (const delayMs of delaysMs) {
    const delay = Math.round((delayMs / 1000) * sampleRate);
    const line = new Float32Array(delay);
    let cursor = 0;
    for (let n = 0; n < dry.length; n++) {
      const delayed = line[cursor]!;
      line[cursor] = dry[n]! + 0.78 * delayed;
      cursor = cursor + 1 === delay ? 0 : cursor + 1;
      wet[n]! += delayed;
    }
  }
  const scale = 1 / delaysMs.length;
  for (let n = 0; n < wet.length; n++) wet[n]! *= scale;
  return wet;
}

interface ToneShape {
  /** Relative amplitude of harmonic h at index h - 1. */
  harmonics: readonly number[];
  attackSec: number;
  /** Exponential decay time constant; Infinity = sustained. */
  decaySec: number;
  releaseSec: number;
}

function harmonicSeries(count: number, exponent: number): number[] {
  return Array.from({ length: count }, (_, index) => 1 / (index + 1) ** exponent);
}

const PAD_SHAPE: ToneShape = {
  harmonics: harmonicSeries(10, 1),
  attackSec: 0.08,
  decaySec: Infinity,
  releaseSec: 0.15,
};
const ARPEGGIO_SHAPE: ToneShape = {
  harmonics: harmonicSeries(8, 1.5),
  attackSec: 0.005,
  decaySec: 0.18,
  releaseSec: 0.03,
};
const BASS_SHAPE: ToneShape = {
  harmonics: harmonicSeries(10, 1.5),
  attackSec: 0.008,
  decaySec: 0.9,
  releaseSec: 0.04,
};
/** A sawtooth-like synth lead: bright, sustained, perfectly steady in pitch. */
const LEAD_SHAPE: ToneShape = {
  harmonics: harmonicSeries(16, 1),
  attackSec: 0.01,
  decaySec: Infinity,
  releaseSec: 0.05,
};

/** Adds one harmonic tone to a channel using a two-multiply resonator per harmonic. */
function addTone(
  channel: Float32Array,
  sampleRate: number,
  event: ToneEvent,
  frequencyHz: number,
  shape: ToneShape,
  channelGain: number,
  random: SeededRandom,
): void {
  if (channelGain === 0) return;
  const first = Math.max(0, Math.round(event.startSec * sampleRate));
  const length = Math.min(
    channel.length - first,
    Math.round((event.durationSec + shape.releaseSec) * sampleRate),
  );
  if (length <= 0) return;
  const envelope = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;
    let value = Math.min(1, time / shape.attackSec);
    if (Number.isFinite(shape.decaySec)) value *= Math.exp(-time / shape.decaySec);
    const untilEnd = event.durationSec + shape.releaseSec - time;
    value *= Math.min(1, untilEnd / shape.releaseSec);
    envelope[i] = value * event.velocity * channelGain;
  }
  shape.harmonics.forEach((amplitude, index) => {
    const harmonicHz = frequencyHz * (index + 1);
    if (harmonicHz > 0.45 * sampleRate) return;
    const omega = (2 * Math.PI * harmonicHz) / sampleRate;
    const startPhase = random.range(0, 2 * Math.PI);
    const coefficient = 2 * Math.cos(omega);
    let previous = Math.sin(startPhase - 2 * omega);
    let current = Math.sin(startPhase - omega);
    for (let i = 0; i < length; i++) {
      const value = coefficient * current - previous;
      previous = current;
      current = value;
      channel[first + i]! += amplitude * envelope[i]! * value;
    }
  });
}

function panGains(pan: number): [number, number] {
  const angle = ((pan + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

interface StereoBuffer {
  left: Float32Array;
  right: Float32Array;
}

function createStereo(sampleCount: number): StereoBuffer {
  return { left: new Float32Array(sampleCount), right: new Float32Array(sampleCount) };
}

function renderPads(
  events: readonly ToneEvent[],
  sampleCount: number,
  sampleRate: number,
  tuningCents: number,
  random: SeededRandom,
): StereoBuffer {
  // A "wide" pad: two slightly detuned, independent copies, one per side.
  const buffer = createStereo(sampleCount);
  for (const event of events) {
    addTone(
      buffer.left,
      sampleRate,
      event,
      tuned(event.midi - 0.07, tuningCents),
      PAD_SHAPE,
      1,
      random,
    );
    addTone(
      buffer.right,
      sampleRate,
      event,
      tuned(event.midi + 0.07, tuningCents),
      PAD_SHAPE,
      1,
      random,
    );
  }
  return buffer;
}

function renderPannedTones(
  events: readonly ToneEvent[],
  shape: ToneShape,
  sampleCount: number,
  sampleRate: number,
  tuningCents: number,
  random: SeededRandom,
): StereoBuffer {
  const buffer = createStereo(sampleCount);
  for (const event of events) {
    const [leftGain, rightGain] = panGains(event.pan);
    const frequency = tuned(event.midi, tuningCents);
    // One oscillator feeds both sides (amplitude panning), so the phases must match.
    const phaseSeed = random.integer(0, 0x7fffffff);
    addTone(
      buffer.left,
      sampleRate,
      event,
      frequency,
      shape,
      leftGain,
      new SeededRandom(phaseSeed),
    );
    addTone(
      buffer.right,
      sampleRate,
      event,
      frequency,
      shape,
      rightGain,
      new SeededRandom(phaseSeed),
    );
  }
  return buffer;
}

function renderDrums(
  hits: readonly DrumHit[],
  sampleCount: number,
  sampleRate: number,
  random: SeededRandom,
): StereoBuffer {
  const buffer = createStereo(sampleCount);
  const [hatLeft, hatRight] = panGains(0.3);
  for (const hit of hits) {
    const first = Math.round(hit.timeSec * sampleRate);
    if (hit.kind === 'kick') {
      const length = Math.round(0.25 * sampleRate);
      let phase = 0;
      for (let i = 0; i < length && first + i < sampleCount; i++) {
        const time = i / sampleRate;
        const frequency = 45 + 65 * Math.exp(-time / 0.03);
        phase += (2 * Math.PI * frequency) / sampleRate;
        const value = hit.velocity * Math.exp(-time / 0.06) * Math.sin(phase);
        buffer.left[first + i]! += value;
        buffer.right[first + i]! += value;
      }
    } else if (hit.kind === 'snare') {
      const length = Math.round(0.2 * sampleRate);
      for (let i = 0; i < length && first + i < sampleCount; i++) {
        const time = i / sampleRate;
        const body = 0.5 * Math.exp(-time / 0.03) * Math.sin(2 * Math.PI * 190 * time);
        const rattle = Math.exp(-time / 0.045) * random.noise();
        const value = hit.velocity * (body + rattle);
        buffer.left[first + i]! += value;
        buffer.right[first + i]! += value;
      }
    } else {
      const length = Math.round(0.06 * sampleRate);
      let previousNoise = 0;
      for (let i = 0; i < length && first + i < sampleCount; i++) {
        // First difference of white noise = crude high-pass, for a bright hi-hat.
        const white = random.noise();
        const bright = white - previousNoise;
        previousNoise = white;
        const value = hit.velocity * Math.exp(-i / (0.015 * sampleRate)) * bright;
        buffer.left[first + i]! += hatLeft * value;
        buffer.right[first + i]! += hatRight * value;
      }
    }
  }
  return buffer;
}

function rms(buffer: StereoBuffer, include?: (index: number) => boolean): number {
  let sum = 0;
  let count = 0;
  for (let n = 0; n < buffer.left.length; n++) {
    if (include && !include(n)) continue;
    sum += 0.5 * (buffer.left[n]! ** 2 + buffer.right[n]! ** 2);
    count++;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

/** Scales a buffer's side signal (L-R)/2 by `width`, leaving its mid signal untouched. */
function setWidth(buffer: StereoBuffer, width: number): void {
  if (width === 1) return;
  for (let n = 0; n < buffer.left.length; n++) {
    const mid = 0.5 * (buffer.left[n]! + buffer.right[n]!);
    const side = 0.5 * width * (buffer.left[n]! - buffer.right[n]!);
    buffer.left[n] = mid + side;
    buffer.right[n] = mid - side;
  }
}

function addScaled(target: StereoBuffer, source: StereoBuffer, gain: number): void {
  for (let n = 0; n < target.left.length; n++) {
    target.left[n]! += gain * source.left[n]!;
    target.right[n]! += gain * source.right[n]!;
  }
}

/** Mixes a stem into the accompaniment at a given RMS level (so the balance is controlled). */
function addStemAtLevel(target: StereoBuffer, stem: StereoBuffer, levelDb: number): void {
  const level = rms(stem);
  if (level > 0) addScaled(target, stem, 10 ** (levelDb / 20) / level);
}

function buildTruth(
  score: SongScore,
  control: VocalControl | null,
  sampleRate: number,
  tuningCents: number,
): SongTruth {
  const frameCount = Math.floor(score.spec.durationSec / TRUTH_HOP_SEC);
  const f0Hz = new Float32Array(frameCount);
  if (control) {
    for (let frame = 0; frame < frameCount; frame++) {
      const sample = Math.round(frame * TRUTH_HOP_SEC * sampleRate);
      if (sample < control.f0.length && control.gain[sample]! >= VOICED_GAIN_THRESHOLD) {
        f0Hz[frame] = control.f0[sample]!;
      }
    }
  }
  const notes = control
    ? score.vocal.map((note) => ({
        startSec: note.startSec + note.consonantSec,
        endSec: note.endSec,
        midi: note.midi,
      }))
    : [];
  return {
    hopSec: TRUTH_HOP_SEC,
    f0Hz,
    notes,
    key: { tonic: score.spec.tonic, mode: score.spec.mode },
    tuningCents,
  };
}

export function renderSong(score: SongScore, options: RenderOptions): RenderedSong {
  const { sampleRate } = options;
  const tuningCents = options.tuningCents ?? 0;
  const includeVocal = options.includeVocal ?? true;
  const sampleCount = Math.round(score.spec.durationSec * sampleRate);
  // Noise and oscillator phases come from their own stream so that the score alone decides
  // the music, whatever the sample rate.
  const random = new SeededRandom(score.spec.seed ^ 0x5bd1e995);

  const stems: Partial<Record<StemName, StereoBuffer>> = {
    pads: renderPads(score.pads, sampleCount, sampleRate, tuningCents, random),
    arpeggio: renderPannedTones(
      score.arpeggio,
      ARPEGGIO_SHAPE,
      sampleCount,
      sampleRate,
      tuningCents,
      random,
    ),
    bass: renderPannedTones(score.bass, BASS_SHAPE, sampleCount, sampleRate, tuningCents, random),
    drums: renderDrums(score.drums, sampleCount, sampleRate, random),
  };
  // Its own random stream, so that everything else is identical with or without it.
  if (options.includeLead) {
    stems.lead = renderPannedTones(
      score.lead,
      LEAD_SHAPE,
      sampleCount,
      sampleRate,
      tuningCents,
      new SeededRandom(score.spec.seed ^ 0x1f3d5b79),
    );
  }
  const accompaniment = createStereo(sampleCount);
  for (const name of Object.keys(stems) as StemName[]) {
    const stem = stems[name]!;
    const offsetDb = options.stemLevelsDb?.[name];
    if (offsetDb === null) continue;
    setWidth(stem, (options.stemWidths?.[name] ?? 1) * (options.accompanimentWidth ?? 1));
    addStemAtLevel(accompaniment, stem, DEFAULT_STEM_LEVELS_DB[name] + (offsetDb ?? 0));
  }

  const mix = createStereo(sampleCount);
  addScaled(mix, accompaniment, 1);

  let control: VocalControl | null = null;
  if (includeVocal) {
    control = buildVocalControl(score.vocal, sampleCount, sampleRate, tuningCents, random);
    const dry = renderVoice(control, sampleRate, random);
    addBreaths(dry, score.breaths, sampleRate, random);
    const vocal: StereoBuffer = { left: dry.slice(), right: dry.slice() };
    if (options.reverb) {
      const wetLeft = reverbTail(dry, sampleRate, [29.7, 37.1, 41.1, 43.7]);
      const wetRight = reverbTail(dry, sampleRate, [31.3, 36.7, 40.3, 44.9]);
      for (let n = 0; n < sampleCount; n++) {
        vocal.left[n]! += 0.3 * wetLeft[n]!;
        vocal.right[n]! += 0.3 * wetRight[n]!;
      }
    }
    const gainEnvelope = control.gain;
    const whileSinging = (index: number) => gainEnvelope[index]! >= VOICED_GAIN_THRESHOLD;
    const vocalLevel = rms(vocal, whileSinging);
    const accompanimentLevel = rms(accompaniment, whileSinging);
    const reference = accompanimentLevel > 0 ? accompanimentLevel : 1;
    // A song too short to contain any singing simply has no vocal in the mix.
    if (vocalLevel > 0) {
      addScaled(mix, vocal, (reference * 10 ** (options.vocalGainDb / 20)) / vocalLevel);
    }
  }

  let peak = 1e-9;
  for (let n = 0; n < sampleCount; n++) {
    peak = Math.max(peak, Math.abs(mix.left[n]!), Math.abs(mix.right[n]!));
  }
  const normalizer = 0.9 / peak;
  for (const buffer of [mix, accompaniment]) {
    for (let n = 0; n < sampleCount; n++) {
      buffer.left[n]! *= normalizer;
      buffer.right[n]! *= normalizer;
    }
  }

  return {
    mix: { left: mix.left, right: mix.right, sampleRate },
    instrumental: { left: accompaniment.left, right: accompaniment.right, sampleRate },
    truth: buildTruth(score, control, sampleRate, tuningCents),
  };
}
