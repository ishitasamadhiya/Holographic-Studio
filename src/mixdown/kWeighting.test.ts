import { describe, expect, it } from 'vitest';
import { biquadMagnitude, kWeightingCoefficients } from './kWeighting';

function totalGainDb(frequencyHz: number, sampleRate: number): number {
  const { shelf, highPass } = kWeightingCoefficients(sampleRate);
  return (
    20 *
    Math.log10(
      biquadMagnitude(shelf, frequencyHz, sampleRate) *
        biquadMagnitude(highPass, frequencyHz, sampleRate),
    )
  );
}

describe('kWeightingCoefficients', () => {
  it('reproduces the 48 kHz coefficient tables of ITU-R BS.1770-4', () => {
    const { shelf, highPass } = kWeightingCoefficients(48000);
    // Table 1 (stage 1, the shelf).
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 9);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 9);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 9);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 9);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 9);
    // Table 2 (stage 2, the RLB high-pass).
    expect(highPass.b0).toBe(1);
    expect(highPass.b1).toBe(-2);
    expect(highPass.b2).toBe(1);
    expect(highPass.a1).toBeCloseTo(-1.99004745483398, 9);
    expect(highPass.a2).toBeCloseTo(0.99007225036621, 9);
  });

  it('has the K-weighting shape: bass rolled off, +0.69 dB at 1 kHz, +4 dB shelf on top', () => {
    expect(totalGainDb(20, 48000)).toBeLessThan(-10);
    expect(totalGainDb(997, 48000)).toBeCloseTo(0.691, 2);
    expect(totalGainDb(10_000, 48000)).toBeCloseTo(4.0, 1);
  });

  it.each([44100, 88200, 96000])(
    'keeps the same response when re-derived for %d Hz',
    (sampleRate) => {
      for (const frequencyHz of [50, 100, 997, 4000, 10_000]) {
        expect(totalGainDb(frequencyHz, sampleRate)).toBeCloseTo(
          totalGainDb(frequencyHz, 48000),
          1,
        );
      }
    },
  );
});
