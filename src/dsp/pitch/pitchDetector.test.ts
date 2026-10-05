import { midiToHz } from '@shared/music';
import { describe, expect, it } from 'vitest';
import { centsBetween } from '../testing/measure';
import { createGaussian, createRandom } from '../testing/random';
import { harmonicTone, synthesizeVoice, whiteNoise } from '../testing/syntheticVoice';
import { PITCH_MAX_HZ, PITCH_MIN_HZ, PitchDetector } from './pitchDetector';

const SAMPLE_RATE = 48000;

interface Estimate {
  timeSec: number;
  voiced: boolean;
  f0Hz: number;
  clarity: number;
}

/**
 * Feeds `signal` to a detector in stretches that end exactly at each estimate and calls
 * `onEstimate` with the index of the sample that completed it.
 */
function feed(
  detector: PitchDetector,
  signal: Float32Array,
  onEstimate: (sampleIndex: number) => void,
): void {
  for (let offset = 0; offset < signal.length;) {
    const frames = Math.min(detector.framesUntilEstimate, signal.length - offset);
    const published = detector.push(signal, offset, frames);
    offset += frames;
    if (published) onEstimate(offset - 1);
  }
}

function detect(signal: Float32Array, sampleRate = SAMPLE_RATE): Estimate[] {
  const detector = new PitchDetector({ sampleRate });
  const estimates: Estimate[] = [];
  feed(detector, signal, (sampleIndex) => {
    estimates.push({
      timeSec: sampleIndex / sampleRate,
      voiced: detector.voiced,
      f0Hz: detector.f0Hz,
      clarity: detector.clarity,
    });
  });
  return estimates;
}

/** Largest pitch error in cents over the estimates after `fromSec`; all must be voiced. */
function worstErrorCents(estimates: Estimate[], expectedHz: number, fromSec = 0.1): number {
  let worst = 0;
  for (const estimate of estimates) {
    if (estimate.timeSec < fromSec) continue;
    if (!estimate.voiced) return Infinity;
    worst = Math.max(worst, Math.abs(centsBetween(estimate.f0Hz, expectedHz)));
  }
  return worst;
}

const TEST_PITCHES_HZ = [80, 98.3, 123.5, 164.8, 220, 277.2, 370, 466.2, 587.3, 740, 900];

describe('PitchDetector accuracy on harmonic tones', () => {
  const spectra: Record<string, number[]> = {
    'a pure sine': [1],
    'a bright tone (8 harmonics)': [1, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6, 1 / 7, 1 / 8],
    'a weak fundamental (-26 dB)': [0.05, 1, 0.8, 0.6, 0.4],
    'a missing fundamental': [0, 1, 1, 1, 0.5],
    'a dominant second harmonic': [0.3, 1, 0.2, 0.1],
  };

  for (const [name, harmonics] of Object.entries(spectra)) {
    it(`is within one cent from 80 to 900 Hz for ${name}`, () => {
      for (const f0Hz of TEST_PITCHES_HZ) {
        const tone = harmonicTone({ sampleRate: SAMPLE_RATE, durationSec: 0.3, f0Hz, harmonics });
        expect(worstErrorCents(detect(tone), f0Hz), `${f0Hz} Hz`).toBeLessThan(1);
      }
    });
  }

  it('never mistakes a harmonic or a multiple of the period for the pitch, at any frequency', () => {
    // Semitone steps over the whole range: every alignment of the period with the
    // detector's internal sampling grid is exercised, for spectra dominated by each of the
    // first four harmonics.
    const dominated: number[][] = [
      [1, 0.1, 0.05],
      [0.3, 1, 0.2, 0.1],
      [0.3, 0.2, 1, 0.2, 0.1],
      [0.4, 0.3, 0.2, 1, 0.2],
      [0, 1, 1, 1, 0.5],
      [1, 0, 0.5, 0, 0.3, 0, 0.2],
    ];
    for (const harmonics of dominated) {
      for (let semitone = 0; semitone <= 46; semitone++) {
        const f0Hz = PITCH_MIN_HZ * 2 ** ((semitone + 0.37) / 12);
        const tone = harmonicTone({ sampleRate: SAMPLE_RATE, durationSec: 0.12, f0Hz, harmonics });
        const worst = worstErrorCents(detect(tone), f0Hz, 0.06);
        expect(worst, `${f0Hz.toFixed(1)} Hz, harmonics ${harmonics.join('/')}`).toBeLessThan(2);
      }
    }
  });

  it('covers the advertised range', () => {
    expect(PITCH_MIN_HZ).toBe(70);
    expect(PITCH_MAX_HZ).toBe(1000);
    for (const f0Hz of [70, 1000]) {
      const tone = harmonicTone({
        sampleRate: SAMPLE_RATE,
        durationSec: 0.3,
        f0Hz,
        harmonics: [1, 0.5, 0.3],
      });
      expect(worstErrorCents(detect(tone), f0Hz), `${f0Hz} Hz`).toBeLessThan(2);
    }
  });

  it('works at 44.1 kHz too', () => {
    for (const f0Hz of [110, 440, 830]) {
      const tone = harmonicTone({
        sampleRate: 44100,
        durationSec: 0.3,
        f0Hz,
        harmonics: [1, 0.5, 0.3, 0.2],
      });
      expect(worstErrorCents(detect(tone, 44100), f0Hz), `${f0Hz} Hz`).toBeLessThan(1);
    }
  });
});

describe('PitchDetector on the synthetic voice', () => {
  it('makes no octave errors and stays within 3 cents over three octaves', () => {
    for (const midi of [40, 45, 50, 55, 60, 64, 69, 74, 79]) {
      for (const fundamentalGain of [1, 0.5]) {
        const voice = synthesizeVoice({
          sampleRate: SAMPLE_RATE,
          durationSec: 0.6,
          midi,
          breathLevel: 0.05,
          fundamentalGain,
          seed: midi,
        });
        const worst = worstErrorCents(detect(voice), midiToHz(midi));
        expect(worst, `midi ${midi}, fundamental × ${fundamentalGain}`).toBeLessThan(3);
      }
    }
  });

  it('keeps the octave on a rough, breathy voice', () => {
    for (const midi of [43, 52, 60, 67, 76]) {
      const voice = synthesizeVoice({
        sampleRate: SAMPLE_RATE,
        durationSec: 1,
        midi,
        jitterCents: 15,
        breathLevel: 0.2,
        seed: 100 + midi,
      });
      const estimates = detect(voice).filter((estimate) => estimate.timeSec > 0.1);
      const voiced = estimates.filter((estimate) => estimate.voiced);
      expect(voiced.length / estimates.length, `midi ${midi}`).toBeGreaterThan(0.95);
      for (const estimate of voiced) {
        // Jitter moves the pitch by tens of cents; an octave or harmonic error is 700+.
        expect(Math.abs(centsBetween(estimate.f0Hz, midiToHz(midi)))).toBeLessThan(100);
      }
    }
  });

  it('tracks vibrato with a delay of about one pitch period', () => {
    const vibratoHz = 5.5;
    const vibratoCents = 50;
    for (const midi of [45, 57, 69]) {
      const centerHz = midiToHz(midi);
      const voice = synthesizeVoice({
        sampleRate: SAMPLE_RATE,
        durationSec: 1.2,
        midi,
        vibratoHz,
        vibratoCents,
        breathLevel: 0.05,
      });
      const estimates = detect(voice).filter((estimate) => estimate.timeSec > 0.2);
      // The estimate describes the last two periods, so it is centred one period back
      // (but never less than the 4 ms minimum comparison window allows).
      const delaySec = Math.max(1 / centerHz, 0.003);
      let squaredError = 0;
      let lowest = Infinity;
      let highest = -Infinity;
      for (const estimate of estimates) {
        expect(estimate.voiced).toBe(true);
        const cents = centsBetween(estimate.f0Hz, centerHz);
        const truth =
          vibratoCents * Math.sin(2 * Math.PI * vibratoHz * (estimate.timeSec - delaySec));
        squaredError += (cents - truth) * (cents - truth);
        lowest = Math.min(lowest, cents);
        highest = Math.max(highest, cents);
      }
      expect(Math.sqrt(squaredError / estimates.length), `midi ${midi}`).toBeLessThan(4);
      expect(highest - lowest, `midi ${midi}`).toBeGreaterThan(1.9 * vibratoCents);
      expect(highest - lowest, `midi ${midi}`).toBeLessThan(2.1 * vibratoCents);
    }
  });

  it('follows a real octave jump within 60 ms', () => {
    const voice = synthesizeVoice({
      sampleRate: SAMPLE_RATE,
      durationSec: 1,
      midi: (timeSec) => (timeSec < 0.5 ? 57 : 69),
      breathLevel: 0.05,
    });
    const estimates = detect(voice);
    const before = estimates.filter((e) => e.timeSec > 0.2 && e.timeSec < 0.49);
    const after = estimates.filter((e) => e.timeSec > 0.56);
    for (const estimate of before) {
      expect(Math.abs(centsBetween(estimate.f0Hz, midiToHz(57)))).toBeLessThan(3);
    }
    for (const estimate of after) {
      expect(Math.abs(centsBetween(estimate.f0Hz, midiToHz(69)))).toBeLessThan(3);
    }
    // And the other way round.
    const down = detect(
      synthesizeVoice({
        sampleRate: SAMPLE_RATE,
        durationSec: 1,
        midi: (timeSec) => (timeSec < 0.5 ? 69 : 57),
        breathLevel: 0.05,
      }),
    );
    for (const estimate of down.filter((e) => e.timeSec > 0.56)) {
      expect(Math.abs(centsBetween(estimate.f0Hz, midiToHz(57)))).toBeLessThan(3);
    }
  });
});

describe('PitchDetector voicing decision', () => {
  it('reports unvoiced for silence', () => {
    const estimates = detect(new Float32Array(SAMPLE_RATE / 2));
    expect(estimates.length).toBeGreaterThan(90);
    for (const estimate of estimates) {
      expect(estimate.voiced).toBe(false);
      expect(estimate.f0Hz).toBe(0);
      expect(estimate.clarity).toBe(0);
    }
  });

  it('reports unvoiced for noise at any level', () => {
    for (const level of [0.01, 0.1, 0.5]) {
      const estimates = detect(whiteNoise(SAMPLE_RATE, 2, level, 3));
      for (const estimate of estimates) {
        expect(estimate.voiced).toBe(false);
        expect(estimate.clarity).toBeLessThan(0.5);
      }
    }
  });

  it('rarely calls low-frequency room noise voiced', () => {
    // Rumble-like noise scores far higher clarity than white noise; a single estimate above
    // the gate must not be enough.
    const random = createGaussian(createRandom(11));
    const noise = (cornerHz: number, poles: number, dbfs: number): Float32Array => {
      const signal = new Float32Array(3 * SAMPLE_RATE);
      const coefficient = 1 - Math.exp((-2 * Math.PI * cornerHz) / SAMPLE_RATE);
      let first = 0;
      let second = 0;
      let power = 0;
      for (let n = 0; n < signal.length; n++) {
        first += coefficient * (random() - first);
        second += coefficient * (first - second);
        signal[n] = poles === 1 ? first : second;
        power += signal[n]! * signal[n]!;
      }
      const gain = 10 ** (dbfs / 20) / Math.sqrt(power / signal.length);
      return signal.map((sample) => sample * gain);
    };
    let voiced = 0;
    let total = 0;
    for (const [cornerHz, poles] of [
      [100, 2],
      [200, 2],
      [300, 2],
      [500, 2],
      [300, 1],
      [20, 1],
    ] as const) {
      for (const dbfs of [-40, -30]) {
        const estimates = detect(noise(cornerHz, poles, dbfs));
        const fraction = estimates.filter((estimate) => estimate.voiced).length / estimates.length;
        expect(fraction, `${cornerHz} Hz, ${poles} pole(s), ${dbfs} dBFS`).toBeLessThan(0.05);
        voiced += fraction * estimates.length;
        total += estimates.length;
      }
    }
    expect(voiced / total).toBeLessThan(0.02);
  });

  it('reports no wildly wrong pitch around note onsets and endings', () => {
    // Before a full period of a new note is in the window, the newest milliseconds are a
    // ringing first formant; after it ends, the formant and the input filters ring on.
    let gross = 0;
    let voiced = 0;
    for (let midi = 38; midi <= 60; midi += 2) {
      const notes = synthesizeVoice({
        sampleRate: SAMPLE_RATE,
        durationSec: 1.2,
        midi: (t) => ((t > 0.1 && t < 0.4) || (t > 0.6 && t < 0.9) ? midi : Number.NaN),
        breathLevel: 0.1,
        seed: midi,
      });
      for (const estimate of detect(notes)) {
        if (!estimate.voiced) continue;
        voiced++;
        if (Math.abs(centsBetween(estimate.f0Hz, midiToHz(midi))) > 100) gross++;
      }
    }
    expect(voiced).toBeGreaterThan(1300);
    expect(gross / voiced).toBeLessThan(0.005);
  });

  it('treats a voice far below the noise floor as silence', () => {
    const voice = synthesizeVoice({
      sampleRate: SAMPLE_RATE,
      durationSec: 0.5,
      midi: 57,
      level: 0.0002,
    });
    expect(detect(voice).some((estimate) => estimate.voiced)).toBe(false);
  });

  it('is not fooled by a DC offset or mains hum under the voice', () => {
    const voice = synthesizeVoice({ sampleRate: SAMPLE_RATE, durationSec: 0.6, midi: 60 });
    for (let n = 0; n < voice.length; n++) {
      voice[n] = voice[n]! + 0.2 + 0.03 * Math.sin((2 * Math.PI * 50 * n) / SAMPLE_RATE);
    }
    expect(worstErrorCents(detect(voice), midiToHz(60), 0.15)).toBeLessThan(5);

    const offsetOnly = new Float32Array(SAMPLE_RATE / 2).fill(0.3);
    const late = detect(offsetOnly).filter((estimate) => estimate.timeSec > 0.2);
    expect(late.some((estimate) => estimate.voiced)).toBe(false);
  });

  it('detects a note quickly and lets go of it quickly', () => {
    for (const midi of [45, 57, 69]) {
      const voice = synthesizeVoice({
        sampleRate: SAMPLE_RATE,
        durationSec: 1,
        midi: (timeSec) => (timeSec >= 0.3 && timeSec < 0.6 ? midi : Number.NaN),
        breathLevel: 0.05,
      });
      const estimates = detect(voice);
      const firstVoiced = estimates.find((estimate) => estimate.voiced);
      const firstUnvoicedAfter = estimates.find((e) => e.timeSec > 0.6 && !e.voiced);
      expect(firstVoiced!.timeSec - 0.3, `onset, midi ${midi}`).toBeLessThan(0.03);
      expect(firstVoiced!.timeSec).toBeGreaterThan(0.3);
      // Includes the voice's own 8 ms release.
      expect(firstUnvoicedAfter!.timeSec - 0.6, `release, midi ${midi}`).toBeLessThan(0.03);
    }
  });
});

describe('PitchDetector streaming behaviour', () => {
  it('publishes one estimate every 5 ms, whatever the signal', () => {
    const detector = new PitchDetector({ sampleRate: SAMPLE_RATE });
    expect(detector.hopSamples).toBe(240);
    expect(detector.framesUntilEstimate).toBe(240);
    const voice = synthesizeVoice({ sampleRate: SAMPLE_RATE, durationSec: 0.5, midi: 52 });
    const estimates = detect(voice);
    expect(estimates.length).toBe(Math.floor(voice.length / 240));
    expect(estimates[0]!.timeSec).toBeCloseTo(239 / SAMPLE_RATE, 9);
    for (let i = 1; i < estimates.length; i++) {
      expect(estimates[i]!.timeSec - estimates[i - 1]!.timeSec).toBeCloseTo(0.005, 9);
    }
  });

  it('gives the same estimates however the signal is cut into blocks', () => {
    const voice = synthesizeVoice({
      sampleRate: SAMPLE_RATE,
      durationSec: 0.6,
      midi: (timeSec) => (timeSec < 0.3 ? 50 : 57.3),
      vibratoCents: 30,
      breathLevel: 0.1,
    });
    const reference = detect(voice).map((estimate) => estimate.f0Hz);
    for (const blockSize of [1, 7, 128, 240, 1000, voice.length]) {
      const detector = new PitchDetector({ sampleRate: SAMPLE_RATE });
      const track: number[] = [];
      let countdown = detector.framesUntilEstimate;
      for (let offset = 0; offset < voice.length; offset += blockSize) {
        const frames = Math.min(blockSize, voice.length - offset);
        const published = detector.push(voice, offset, frames);
        // A block that spans several hops reports that at least one estimate was made;
        // the published fields then hold the latest one.
        expect(published).toBe(frames >= countdown);
        countdown = detector.framesUntilEstimate;
        if (published && blockSize <= 240) track.push(detector.f0Hz);
      }
      if (blockSize <= 240) expect(track, `block size ${blockSize}`).toEqual(reference);
      else expect(detector.f0Hz).toBe(reference[Math.floor(voice.length / 240) - 1]);
    }
  });

  it('reports the period in samples alongside the frequency', () => {
    const detector = new PitchDetector({ sampleRate: SAMPLE_RATE });
    const tone = harmonicTone({
      sampleRate: SAMPLE_RATE,
      durationSec: 0.2,
      f0Hz: 200,
      harmonics: [1, 0.5],
    });
    detector.push(tone, 0, tone.length);
    expect(detector.voiced).toBe(true);
    expect(detector.periodSamples).toBeCloseTo(240, 1);
    expect(detector.f0Hz * detector.periodSamples).toBeCloseTo(SAMPLE_RATE, 6);
  });

  it('starts from scratch after reset', () => {
    const voice = synthesizeVoice({ sampleRate: SAMPLE_RATE, durationSec: 0.4, midi: 64 });
    const detector = new PitchDetector({ sampleRate: SAMPLE_RATE });
    const run = (): number[] => {
      const track: number[] = [];
      feed(detector, voice, () => track.push(detector.f0Hz));
      return track;
    };
    const first = run();
    detector.reset();
    expect(detector.voiced).toBe(false);
    expect(detector.f0Hz).toBe(0);
    expect(detector.framesUntilEstimate).toBe(240);
    expect(run()).toEqual(first);
  });
});
