import { midiToHz, type PitchTargetData } from '@shared/music';
import { describe, expect, it } from 'vitest';
import {
  firstDelayedDifference,
  firstDifference,
  maxStep,
  mean,
  rms,
  standardDeviation,
  trackPitchCents,
} from '../testing/measure';
import { synthesizeVoice, whiteNoise } from '../testing/syntheticVoice';
import { AutotuneUnit } from './autotuneUnit';

const SAMPLE_RATE = 48000;
const BLOCK = 128;

interface RunOptions {
  intensity: number | ((timeSec: number) => number);
  targets?: PitchTargetData | null;
  /** Song time of the first input sample; omit for "no song clock". */
  songStartSec?: number;
  onBlock?: (unit: AutotuneUnit, timeSec: number) => void;
}

function run(input: Float32Array, options: RunOptions): Float32Array {
  const unit = new AutotuneUnit(SAMPLE_RATE);
  if (options.targets !== undefined) unit.setPitchTargets(options.targets);
  const left = Float32Array.from(input);
  const right = Float32Array.from(input);
  for (let offset = 0; offset < input.length; offset += BLOCK) {
    const frames = Math.min(BLOCK, input.length - offset);
    const timeSec = offset / SAMPLE_RATE;
    unit.setIntensity(
      typeof options.intensity === 'number' ? options.intensity : options.intensity(timeSec),
    );
    if (options.songStartSec !== undefined) unit.setSongPosition(options.songStartSec + timeSec);
    unit.process(
      left.subarray(offset, offset + frames),
      right.subarray(offset, offset + frames),
      frames,
    );
    options.onBlock?.(unit, timeSec + frames / SAMPLE_RATE);
  }
  expect(firstDifference(right, left)).toBe(-1);
  return left;
}

// A3, sung 40 cents flat with a natural vibrato, a little jitter and breath.
const TARGET_MIDI = 57;
const TARGET_HZ = midiToHz(TARGET_MIDI);
const FLAT_CENTS = -40;
const flatVoice = synthesizeVoice({
  sampleRate: SAMPLE_RATE,
  durationSec: 1.6,
  midi: TARGET_MIDI + FLAT_CENTS / 100,
  vibratoHz: 5.5,
  vibratoCents: 35,
  jitterCents: 3,
  breathLevel: 0.05,
});

/** Pitch of the settled part of a signal, in cents relative to the target note. */
function settledPitch(signal: Float32Array): { meanCents: number; vibratoCents: number } {
  const track = trackPitchCents(signal, {
    sampleRate: SAMPLE_RATE,
    startSec: 0.7,
    endSec: 1.5,
    referenceHz: TARGET_HZ,
    windowSec: 3 / TARGET_HZ,
    searchCents: 200,
  });
  return { meanCents: mean(track), vibratoCents: standardDeviation(track) };
}

describe('AutotuneUnit on a voice sung 40 cents flat', () => {
  const sung = settledPitch(flatVoice);

  it('measures the test voice as intended', () => {
    expect(sung.meanCents).toBeGreaterThan(FLAT_CENTS - 3);
    expect(sung.meanCents).toBeLessThan(FLAT_CENTS + 3);
    expect(sung.vibratoCents).toBeGreaterThan(20);
  });

  it('leaves the signal untouched at intensity 0', () => {
    const unit = new AutotuneUnit(SAMPLE_RATE);
    const output = run(flatVoice, { intensity: 0 });
    expect(firstDelayedDifference(output, flatVoice, unit.latencySamples)).toBe(-1);
    // (The 5 ms delay moves the measurement window slightly along the vibrato.)
    const pitch = settledPitch(output);
    expect(Math.abs(pitch.meanCents - sung.meanCents)).toBeLessThan(1.5);
    expect(Math.abs(pitch.vibratoCents - sung.vibratoCents)).toBeLessThan(1.5);
  });

  it('lands on the note and flattens the vibrato at intensity 1', () => {
    const pitch = settledPitch(run(flatVoice, { intensity: 1 }));
    expect(Math.abs(pitch.meanCents)).toBeLessThan(5);
    expect(pitch.vibratoCents).toBeLessThan(0.35 * sung.vibratoCents);
  });

  it('pulls part of the way and keeps the vibrato at intensity 0.5', () => {
    const pitch = settledPitch(run(flatVoice, { intensity: 0.5 }));
    expect(pitch.meanCents).toBeLessThan(-4);
    expect(pitch.meanCents).toBeGreaterThan(-25);
    expect(pitch.vibratoCents).toBeGreaterThan(0.85 * sung.vibratoCents);
  });

  it('corrects more as the intensity rises', () => {
    const errors = [0, 0.25, 0.5, 0.75].map((intensity) =>
      Math.abs(settledPitch(run(flatVoice, { intensity })).meanCents),
    );
    for (let i = 1; i < errors.length; i++) expect(errors[i]).toBeLessThan(errors[i - 1]! - 5);
    expect(errors[3]).toBeLessThan(5);
  });

  it('keeps the level and adds no clicks while hard-tuning', () => {
    const output = run(flatVoice, { intensity: 1 });
    const from = Math.round(0.3 * SAMPLE_RATE);
    expect(rms(output, from) / rms(flatVoice, from)).toBeGreaterThan(0.97);
    expect(rms(output, from) / rms(flatVoice, from)).toBeLessThan(1.03);
    expect(maxStep(output, from) / maxStep(flatVoice, from)).toBeLessThan(1.15);
  });

  it('reports what it hears and what it does', () => {
    const detected: number[] = [];
    const targeted: number[] = [];
    const corrections: number[] = [];
    run(flatVoice, {
      intensity: 1,
      onBlock: (unit, timeSec) => {
        if (timeSec < 0.7) return;
        detected.push(unit.detectedMidi);
        targeted.push(unit.targetMidi);
        corrections.push(unit.correctionCents);
      },
    });
    expect(mean(detected)).toBeCloseTo(TARGET_MIDI + FLAT_CENTS / 100, 1);
    expect(targeted.every((midi) => midi === TARGET_MIDI)).toBe(true);
    expect(mean(corrections)).toBeGreaterThan(35);
    expect(mean(corrections)).toBeLessThan(45);
  });

  it('has the 5 ms latency of its pitch shifter', () => {
    expect(new AutotuneUnit(SAMPLE_RATE).latencySamples).toBe(240);
  });
});

describe('AutotuneUnit with wide vibrato near the midpoint between two notes', () => {
  const C_MAJOR: PitchTargetData = {
    notes: new Float32Array(0),
    key: { tonic: 0, mode: 'major', confidence: 1 },
    tuningCents: 0,
  };
  // Mean pitch, intended note, vibrato, and targets. All sit 40–50 cents from a boundary, so
  // every vibrato cycle swings well across it.
  const cases = [
    { sung: 56.6, note: 57, cents: 60, hz: 5.5, targets: null },
    { sung: 56.55, note: 57, cents: 50, hz: 5.5, targets: null },
    { sung: 56.6, note: 57, cents: 50, hz: 4.5, targets: null },
    { sung: 56.6, note: 57, cents: 60, hz: 6.5, targets: null },
    { sung: 56.6, note: 57, cents: 100, hz: 5.5, targets: null },
    { sung: 64.45, note: 64, cents: 50, hz: 5.5, targets: C_MAJOR },
    { sung: 64.55, note: 65, cents: 100, hz: 6.5, targets: C_MAJOR },
  ];

  for (const { sung, note, cents, hz, targets } of cases) {
    const label = `${sung} ±${cents}c at ${hz} Hz, ${targets ? 'C major' : 'chromatic'}`;
    it(`holds one target and lands on it: ${label}`, () => {
      const voice = synthesizeVoice({
        sampleRate: SAMPLE_RATE,
        durationSec: 1.5,
        midi: sung,
        vibratoHz: hz,
        vibratoCents: cents,
        jitterCents: 3,
        breathLevel: 0.05,
      });
      const measure = (signal: Float32Array) =>
        trackPitchCents(signal, {
          sampleRate: SAMPLE_RATE,
          startSec: 0.6,
          endSec: 1.4,
          referenceHz: midiToHz(note),
          windowSec: 3 / midiToHz(note),
          searchCents: 250,
        });
      const sungTrack = measure(voice);

      for (const intensity of [1, 0.5]) {
        const targetsSeen = new Set<number>();
        const output = run(voice, {
          intensity,
          targets,
          onBlock: (unit, timeSec) => {
            if (timeSec > 0.5) targetsSeen.add(unit.targetMidi);
          },
        });
        expect([...targetsSeen], `${label}, intensity ${intensity}`).toEqual([note]);
        const track = measure(output);
        if (intensity === 1) {
          expect(Math.abs(mean(track)), label).toBeLessThan(10);
          expect(standardDeviation(track), label).toBeLessThan(0.4 * standardDeviation(sungTrack));
        } else {
          // Half-way there, with the vibrato kept.
          const error = Math.abs(mean(track));
          expect(error, label).toBeLessThan(0.45 * Math.abs(mean(sungTrack)));
          expect(error, label).toBeGreaterThan(0.1 * Math.abs(mean(sungTrack)));
          expect(standardDeviation(track), label).toBeGreaterThan(
            0.85 * standardDeviation(sungTrack),
          );
        }
      }
    });
  }
});

describe('AutotuneUnit on unvoiced input', () => {
  it('does not shift noise at all, even at full intensity', () => {
    const noise = whiteNoise(SAMPLE_RATE, 1, 0.1, 21);
    const corrections: number[] = [];
    const output = run(noise, {
      intensity: 1,
      onBlock: (unit) => {
        corrections.push(unit.correctionCents);
        expect(Number.isNaN(unit.detectedMidi)).toBe(true);
        expect(Number.isNaN(unit.targetMidi)).toBe(true);
      },
    });
    expect(firstDelayedDifference(output, noise, 240)).toBe(-1);
    expect(corrections.every((cents) => cents === 0)).toBe(true);
  });

  it('lets go of the correction within 33 ms of the voice stopping', () => {
    const stopSec = 0.6;
    const voice = synthesizeVoice({
      sampleRate: SAMPLE_RATE,
      durationSec: 1,
      midi: (timeSec) => (timeSec < stopSec ? TARGET_MIDI - 0.4 : Number.NaN),
      breathLevel: 0.05,
    });
    const hiss = whiteNoise(SAMPLE_RATE, 1, 0.01, 4);
    const input = voice.map((sample, n) => sample + hiss[n]!);
    let duringNote = 0;
    let lastCorrectedSec = 0;
    run(input, {
      intensity: 1,
      onBlock: (unit, timeSec) => {
        if (timeSec > 0.4 && timeSec < stopSec) duringNote = unit.correctionCents;
        if (Math.abs(unit.correctionCents) >= 1) lastCorrectedSec = timeSec;
      },
    });
    expect(duringNote).toBeGreaterThan(30);
    // The voice itself fades out over 8 ms; the detector needs about a period to notice, two
    // unvoiced estimates (10 ms) are required, and the release then takes ~15 ms.
    expect(lastCorrectedSec - stopSec).toBeLessThan(0.033);
  });
});

describe('AutotuneUnit across note changes', () => {
  // A little melody, every note sung 30 cents flat, with glides between the notes.
  const notes = [57, 59, 60, 64, 62, 57];
  const noteSec = 0.45;
  const glideSec = 0.05;
  const melody = synthesizeVoice({
    sampleRate: SAMPLE_RATE,
    durationSec: notes.length * noteSec,
    midi: (timeSec) => {
      const index = Math.min(notes.length - 1, Math.floor(timeSec / noteSec));
      const previous = notes[Math.max(0, index - 1)]!;
      const progress = Math.min(1, (timeSec - index * noteSec) / glideSec);
      return previous + (notes[index]! - previous) * progress - 0.3;
    },
    vibratoCents: 20,
    jitterCents: 3,
    breathLevel: 0.05,
  });

  it('snaps every note to pitch at intensity 1', () => {
    const output = run(melody, { intensity: 1 });
    for (let index = 0; index < notes.length; index++) {
      const noteHz = midiToHz(notes[index]!);
      const track = trackPitchCents(output, {
        sampleRate: SAMPLE_RATE,
        startSec: index * noteSec + 0.15,
        endSec: (index + 1) * noteSec - 0.03,
        referenceHz: noteHz,
        windowSec: 3 / noteHz,
        searchCents: 150,
      });
      expect(Math.abs(mean(track)), `note ${index}`).toBeLessThan(10);
    }
  });

  it('never pulls a leap back toward the previous note', () => {
    for (const leap of [-12, -7, 5, 7]) {
      // Sung 30 cents sharp throughout; the leap is instantaneous.
      const voice = synthesizeVoice({
        sampleRate: SAMPLE_RATE,
        durationSec: 1,
        midi: (timeSec) => (timeSec < 0.5 ? 60.3 : 60.3 + leap),
        breathLevel: 0.02,
      });
      let largest = 0;
      run(voice, {
        intensity: 1,
        onBlock: (unit) => (largest = Math.max(largest, Math.abs(unit.correctionCents))),
      });
      expect(largest, `leap ${leap}`).toBeLessThan(35);
    }
  });

  it('glides between notes without discontinuities', () => {
    for (const intensity of [0.5, 1]) {
      const output = run(melody, { intensity });
      expect(output.every((sample) => Number.isFinite(sample))).toBe(true);
      // The largest step in the output is no larger than the input's (scaled by the
      // largest possible upward shift of a 30-cent correction plus vibrato).
      expect(maxStep(output) / maxStep(melody)).toBeLessThan(1.15);
      expect(rms(output) / rms(melody)).toBeGreaterThan(0.97);
      expect(rms(output) / rms(melody)).toBeLessThan(1.03);
    }
  });

  it('changes target when the singer does, and only then', () => {
    const targetsSeen: number[] = [];
    run(melody, {
      intensity: 1,
      onBlock: (unit) => {
        const target = unit.targetMidi;
        if (!Number.isNaN(target) && targetsSeen[targetsSeen.length - 1] !== target) {
          targetsSeen.push(target);
        }
      },
    });
    // Glides pass through the semitones in between; what matters is that each sung note is
    // reached, in order, with no flip-flopping back.
    let cursor = 0;
    for (const note of notes) {
      cursor = targetsSeen.indexOf(note, cursor);
      expect(cursor, `note ${note} in ${targetsSeen.join(' ')}`).toBeGreaterThanOrEqual(0);
    }
    expect(targetsSeen.length).toBeLessThanOrEqual(notes.length + 8);
  });
});

describe('AutotuneUnit with pitch targets', () => {
  // The singer holds B♭3 + 30 cents (58.3). Nearest semitone: B♭ (58). Nearest note of C
  // major: B (59, 0.7 away) — A (57) is 1.3 away.
  const sungMidi = 58.3;
  const voice = synthesizeVoice({
    sampleRate: SAMPLE_RATE,
    durationSec: 1.2,
    midi: sungMidi,
    breathLevel: 0.05,
  });
  const measure = (signal: Float32Array, referenceMidi: number) =>
    mean(
      trackPitchCents(signal, {
        sampleRate: SAMPLE_RATE,
        startSec: 0.6,
        endSec: 1.1,
        referenceHz: midiToHz(referenceMidi),
        windowSec: 3 / midiToHz(referenceMidi),
        searchCents: 200,
      }),
    );

  it('snaps to the nearest semitone without targets', () => {
    expect(Math.abs(measure(run(voice, { intensity: 1 }), 58))).toBeLessThan(5);
  });

  it('snaps to the key when one is given', () => {
    const key: PitchTargetData = {
      notes: new Float32Array(0),
      key: { tonic: 0, mode: 'major', confidence: 1 },
      tuningCents: 0,
    };
    expect(Math.abs(measure(run(voice, { intensity: 1, targets: key }), 59))).toBeLessThan(5);
  });

  it('follows the reference melody on the song clock, and ignores it without a clock', () => {
    // The melody holds A3 (57) from 10 s to 12 s of the song: 1.3 semitones below the singer.
    const song: PitchTargetData = {
      notes: Float32Array.of(10, 12, 57),
      key: { tonic: 0, mode: 'major', confidence: 1 },
      tuningCents: 0,
    };
    const onClock = run(voice, { intensity: 1, targets: song, songStartSec: 10.2 });
    expect(Math.abs(measure(onClock, 57))).toBeLessThan(5);

    const elsewhereInTheSong = run(voice, { intensity: 1, targets: song, songStartSec: 30 });
    expect(Math.abs(measure(elsewhereInTheSong, 59))).toBeLessThan(5);

    const noClock = run(voice, { intensity: 1, targets: song });
    expect(Math.abs(measure(noClock, 59))).toBeLessThan(5);
  });

  it('keeps counting song time between position updates', () => {
    // Position given once, 0.5 s before the melody note starts; no further updates.
    const song: PitchTargetData = {
      notes: Float32Array.of(10, 12, 57),
      key: null,
      tuningCents: 0,
    };
    const unit = new AutotuneUnit(SAMPLE_RATE);
    unit.setPitchTargets(song);
    unit.setIntensity(1);
    unit.setSongPosition(9.5);
    const left = Float32Array.from(voice);
    const right = Float32Array.from(voice);
    const seen: number[] = [];
    for (let offset = 0; offset + BLOCK <= voice.length; offset += BLOCK) {
      unit.process(
        left.subarray(offset, offset + BLOCK),
        right.subarray(offset, offset + BLOCK),
        BLOCK,
      );
      seen.push(unit.targetMidi);
    }
    const at = (timeSec: number) => seen[Math.round((timeSec * SAMPLE_RATE) / BLOCK)];
    expect(at(0.2)).toBe(58);
    expect(at(0.7)).toBe(57);
    expect(at(1.1)).toBe(57);
  });

  it('never corrects by more than 3 semitones, even when the melody note is further away', () => {
    // The melody holds C4 (60); the singer sits 2.4 semitones below it, inside the pull range,
    // with a ±100 cent vibrato: at its troughs the pitch is 3.4 semitones from the target.
    const song: PitchTargetData = { notes: Float32Array.of(0, 10, 60), key: null, tuningCents: 0 };
    const wide = synthesizeVoice({
      sampleRate: SAMPLE_RATE,
      durationSec: 1.5,
      midi: 57.6,
      vibratoCents: 100,
      breathLevel: 0.05,
    });
    let largest = 0;
    const targetsSeen = new Set<number>();
    run(wide, {
      intensity: 1,
      targets: song,
      songStartSec: 1,
      onBlock: (unit, timeSec) => {
        largest = Math.max(largest, Math.abs(unit.correctionCents));
        if (timeSec > 0.5) targetsSeen.add(unit.targetMidi);
      },
    });
    expect([...targetsSeen]).toEqual([60]);
    expect(largest).toBeGreaterThan(290);
    expect(largest).toBeLessThanOrEqual(300 + 1e-9);
  });

  it('respects the tuning offset of the song', () => {
    const sharpSong: PitchTargetData = { notes: new Float32Array(0), key: null, tuningCents: 20 };
    const output = run(voice, { intensity: 1, targets: sharpSong });
    // Grid at …, 58.2, 59.2: the singer at 58.3 is pulled to 58.2.
    expect(Math.abs(measure(output, 58.2))).toBeLessThan(5);
  });
});

describe('AutotuneUnit control behaviour', () => {
  it('returns to an exact pass-through at the nominal delay after the intensity goes back to 0', () => {
    // Low voices are where the delay strays furthest from nominal while correcting.
    for (const midi of [43, 45, 48, 57]) {
      const period = SAMPLE_RATE / midiToHz(midi);
      // Sung 35 cents sharp with vibrato; a rest from 1.2 s to 1.4 s, then again.
      const voice = synthesizeVoice({
        sampleRate: SAMPLE_RATE,
        durationSec: 1.8,
        midi: (timeSec) => (timeSec > 1.2 && timeSec < 1.4 ? Number.NaN : midi + 0.35),
        vibratoCents: 20,
        jitterCents: 3,
        breathLevel: 0.05,
      });
      const output = run(voice, { intensity: (timeSec) => (timeSec < 0.5 ? 1 : 0) });
      const delayedCopyAt = (from: number, to: number): number => {
        for (let delay = 2; delay < 1200; delay++) {
          const differs = firstDelayedDifference(output, voice, delay, from);
          if (differs === -1 || differs >= to) return delay;
        }
        return -1;
      };
      // Still singing: an exact copy again, within 0.6 periods of the nominal delay.
      const voicedDelay = delayedCopyAt(1.0 * SAMPLE_RATE, 1.2 * SAMPLE_RATE);
      expect(voicedDelay, `MIDI ${midi}`).toBeGreaterThan(0);
      expect(Math.abs(voicedDelay - 240), `MIDI ${midi}`).toBeLessThanOrEqual(0.6 * period);
      // After the rest: exactly the nominal latency the take is aligned with.
      expect(firstDelayedDifference(output, voice, 240, 1.45 * SAMPLE_RATE), `MIDI ${midi}`).toBe(
        -1,
      );
    }
  });

  it('eases in when the intensity jumps, without a click', () => {
    const output = run(flatVoice, { intensity: (timeSec) => (timeSec < 0.5 ? 0 : 1) });
    const around = Math.round(0.5 * SAMPLE_RATE);
    const step = maxStep(output, around - 2400, around + 4800);
    expect(step / maxStep(flatVoice, around - 2640, around + 4560)).toBeLessThan(1.15);
  });

  it('ignores NaN intensities and clamps out-of-range ones', () => {
    const reference = run(flatVoice, { intensity: 1 });
    expect(firstDifference(run(flatVoice, { intensity: 7 }), reference)).toBe(-1);
    const unit = new AutotuneUnit(SAMPLE_RATE);
    unit.setIntensity(1);
    unit.setIntensity(Number.NaN);
    const left = Float32Array.from(flatVoice);
    const right = Float32Array.from(flatVoice);
    unit.process(left, right, left.length);
    expect(firstDifference(left, reference)).toBe(-1);
  });

  it('behaves identically after reset', () => {
    const unit = new AutotuneUnit(SAMPLE_RATE);
    unit.setIntensity(1);
    const render = (): Float32Array => {
      const left = Float32Array.from(flatVoice);
      const right = Float32Array.from(flatVoice);
      unit.process(left, right, left.length);
      return left;
    };
    render();
    // Reset keeps the intensity (and skips its fade-in), so compare two runs after a reset.
    unit.reset();
    expect(Number.isNaN(unit.detectedMidi)).toBe(true);
    expect(Number.isNaN(unit.targetMidi)).toBe(true);
    expect(unit.correctionCents).toBe(0);
    const afterFirstReset = render();
    expect(unit.correctionCents).not.toBe(0);
    unit.reset();
    expect(firstDifference(render(), afterFirstReset)).toBe(-1);
  });
});
