import { describe, expect, it } from 'vitest';
import { ECHO_FEEDBACK_CAP, ECHO_MAX_FEEDBACK, ECHO_MAX_WET } from '../parameterMapping';
import { firstDifference, peak, rms } from '../testing/measure';
import { synthesizeVoice, whiteNoise } from '../testing/syntheticVoice';
import { ECHO_DELAY_SEC, EchoUnit } from './echo';

const SAMPLE_RATE = 48000;
const DELAY = Math.round(ECHO_DELAY_SEC * SAMPLE_RATE);

interface Stereo {
  left: Float32Array;
  right: Float32Array;
}

function run(
  input: Float32Array,
  intensityAt: number | ((timeSec: number) => number),
  unit = new EchoUnit(SAMPLE_RATE),
): Stereo {
  const left = Float32Array.from(input);
  const right = Float32Array.from(input);
  for (let offset = 0; offset < input.length; offset += 128) {
    const frames = Math.min(128, input.length - offset);
    unit.setIntensity(
      typeof intensityAt === 'number' ? intensityAt : intensityAt(offset / SAMPLE_RATE),
    );
    unit.process(
      left.subarray(offset, offset + frames),
      right.subarray(offset, offset + frames),
      frames,
    );
  }
  return { left, right };
}

/** A unit whose controls have already settled at the given intensity. */
function settledUnit(intensity: number): EchoUnit {
  const unit = new EchoUnit(SAMPLE_RATE);
  unit.setIntensity(intensity);
  unit.reset();
  return unit;
}

function impulse(seconds: number): Float32Array {
  const signal = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  signal[0] = 1;
  return signal;
}

/** Energy of the signal in consecutive windows one echo period long. */
function energyPerRepeat(signal: Float32Array): number[] {
  const energies: number[] = [];
  for (let start = DELAY >> 1; start + DELAY <= signal.length; start += DELAY) {
    let energy = 0;
    for (let n = start; n < start + DELAY; n++) energy += signal[n]! * signal[n]!;
    energies.push(energy);
  }
  return energies;
}

describe('EchoUnit at intensity 0', () => {
  it('is exactly transparent: the wet path is silent', () => {
    const voice = synthesizeVoice({ sampleRate: SAMPLE_RATE, durationSec: 1.5, midi: 57 });
    const { left, right } = run(voice, 0);
    expect(firstDifference(left, voice)).toBe(-1);
    expect(firstDifference(right, voice)).toBe(-1);
  });

  it('adds no latency', () => {
    expect(new EchoUnit(SAMPLE_RATE).latencySamples).toBe(0);
  });
});

describe('EchoUnit at intensity 1', () => {
  const response = run(impulse(12), 1, settledUnit(1));

  it('repeats about every 300 ms, slightly earlier on the left than on the right', () => {
    expect(response.left[0]).toBe(1);
    expect(response.right[0]).toBe(1);
    const firstLeft = response.left.findIndex((sample, n) => n > 0 && sample !== 0);
    const firstRight = response.right.findIndex((sample, n) => n > 0 && sample !== 0);
    expect(firstLeft / SAMPLE_RATE).toBeGreaterThan(0.28);
    expect(firstRight / SAMPLE_RATE).toBeLessThan(0.32);
    expect((firstRight - firstLeft) / SAMPLE_RATE).toBeGreaterThan(0.004);
    expect((firstRight - firstLeft) / SAMPLE_RATE).toBeLessThan(0.02);
  });

  it('makes the first repeat clearly audible: about half the level of the voice', () => {
    const firstLeft = response.left.findIndex((sample, n) => n > 0 && sample !== 0);
    expect(response.left[firstLeft]).toBeCloseTo(ECHO_MAX_WET, 5);
    expect(ECHO_MAX_WET).toBeGreaterThanOrEqual(0.45);
    expect(ECHO_MAX_WET).toBeLessThanOrEqual(0.5);
  });

  it('decays: every repeat has less energy than the one before, down to silence', () => {
    for (const channel of [response.left, response.right]) {
      const energies = energyPerRepeat(channel);
      expect(energies.length).toBeGreaterThan(30);
      for (let i = 1; i < 12; i++) {
        expect(energies[i]!).toBeLessThan(energies[i - 1]! * ECHO_MAX_FEEDBACK ** 2 * 1.05);
      }
      expect(energies[energies.length - 1]!).toBeLessThan(1e-12 * energies[0]!);
    }
  });

  it('makes each repeat darker than the last', () => {
    const burst = whiteNoise(SAMPLE_RATE, 3, 0.2, 2);
    burst.fill(0, Math.round(0.05 * SAMPLE_RATE));
    const { left } = run(burst, 1, settledUnit(1));
    // Share of the energy in sample-to-sample differences: a measure of brightness.
    const brightness = (repeat: number): number => {
      const start = Math.round(repeat * ECHO_DELAY_SEC * 0.985 * SAMPLE_RATE);
      let differences = 0;
      let energy = 0;
      for (let n = start + 1; n < start + Math.round(0.05 * SAMPLE_RATE); n++) {
        differences += (left[n]! - left[n - 1]!) ** 2;
        energy += left[n]! * left[n]!;
      }
      return differences / energy;
    };
    expect(brightness(2)).toBeLessThan(0.7 * brightness(1));
    expect(brightness(3)).toBeLessThan(0.8 * brightness(2));
    expect(brightness(4)).toBeLessThan(brightness(3));
  });

  it('stays bounded for 30 s of loud input', () => {
    // Full-scale noise plus a full-scale tone whose period divides the left delay exactly,
    // so its echoes pile up in phase: the worst case for build-up.
    const seconds = 30;
    const input = whiteNoise(SAMPLE_RATE, seconds, 0.4, 8);
    const leftDelay = Math.round(ECHO_DELAY_SEC * 0.985 * SAMPLE_RATE);
    const toneHz = (150 * SAMPLE_RATE) / leftDelay;
    for (let n = 0; n < input.length; n++) {
      const sample = input[n]! + Math.sin((2 * Math.PI * toneHz * n) / SAMPLE_RATE);
      input[n] = Math.max(-1, Math.min(1, sample));
    }
    const { left, right } = run(input, 1, settledUnit(1));
    // Dry 1 + echoes of at most wet · (1 + f + f² + …).
    const bound = 1 + ECHO_MAX_WET / (1 - ECHO_MAX_FEEDBACK);
    const lastSecond = (seconds - 1) * SAMPLE_RATE;
    for (const channel of [left, right]) {
      expect(channel.every((sample) => Number.isFinite(sample))).toBe(true);
      expect(peak(channel)).toBeLessThan(bound);
      // No slow build-up: the end is no louder than the middle.
      expect(rms(channel, lastSecond)).toBeLessThan(
        1.05 * rms(channel, 10 * SAMPLE_RATE, 11 * SAMPLE_RATE),
      );
    }
    expect(peak(left)).toBeGreaterThan(1.2);
  });

  it('keeps its feedback under the stability cap', () => {
    expect(ECHO_MAX_FEEDBACK).toBeLessThan(ECHO_FEEDBACK_CAP);
    expect(ECHO_FEEDBACK_CAP).toBeLessThan(1);
    // Intensities beyond the range behave exactly like the maximum.
    const reference = run(impulse(3), 1, settledUnit(1));
    const beyond = run(impulse(3), 9, settledUnit(9));
    expect(firstDifference(beyond.left, reference.left)).toBe(-1);
  });
});

describe('EchoUnit when the intensity changes', () => {
  it('lets the tail die away naturally after the intensity drops to 0', () => {
    const seconds = 14;
    const input = new Float32Array(seconds * SAMPLE_RATE);
    input.set(whiteNoise(SAMPLE_RATE, 1, 0.2, 6));
    const { left } = run(input, (timeSec) => (timeSec < 1 ? 1 : 0));
    // Nothing new is sent after 1 s, but what was already in the delay keeps repeating…
    expect(rms(left, 1.1 * SAMPLE_RATE, 1.3 * SAMPLE_RATE)).toBeGreaterThan(0.02);
    expect(rms(left, 1.7 * SAMPLE_RATE, 1.9 * SAMPLE_RATE)).toBeGreaterThan(0.0005);
    // …getting quieter with every pass, until it is gone.
    const energies = energyPerRepeat(left.subarray(Math.round(1.2 * SAMPLE_RATE)));
    for (let i = 1; i < 10; i++) expect(energies[i]!).toBeLessThan(0.5 * energies[i - 1]!);
    expect(peak(left, 13 * SAMPLE_RATE)).toBeLessThan(1e-6);
  });

  it('sends nothing new once closed: a sound made after the drop has no echo', () => {
    const input = new Float32Array(3 * SAMPLE_RATE);
    input[Math.round(1.5 * SAMPLE_RATE)] = 1;
    const { left } = run(input, (timeSec) => (timeSec < 0.5 ? 1 : 0));
    expect(peak(left, Math.round(1.6 * SAMPLE_RATE))).toBe(0);
  });

  it('fades the echo level in smoothly instead of stepping', () => {
    // A constant input makes the send gain directly visible in the first echo.
    const input = new Float32Array(SAMPLE_RATE).fill(0.5);
    const { left } = run(input, 1);
    const firstEcho = Math.round(ECHO_DELAY_SEC * 0.985 * SAMPLE_RATE);
    let largestStep = 0;
    for (let n = firstEcho; n < firstEcho + 9600; n++) {
      largestStep = Math.max(largestStep, Math.abs(left[n]! - left[n - 1]!));
    }
    expect(left[firstEcho + 9600]! - 0.5).toBeCloseTo(0.5 * ECHO_MAX_WET, 2);
    expect(largestStep).toBeLessThan(0.001);
  });

  it('ignores NaN intensities', () => {
    const unit = settledUnit(1);
    unit.setIntensity(Number.NaN);
    const withNaN = run(impulse(1), Number.NaN, unit);
    const reference = run(impulse(1), 1, settledUnit(1));
    expect(firstDifference(withNaN.left, reference.left)).toBe(-1);
  });

  it('is silent again after reset', () => {
    const unit = settledUnit(1);
    run(whiteNoise(SAMPLE_RATE, 1, 0.3, 3), 1, unit);
    unit.reset();
    const { left, right } = run(new Float32Array(SAMPLE_RATE), 1, unit);
    expect(peak(left)).toBe(0);
    expect(peak(right)).toBe(0);
  });
});
