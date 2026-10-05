// Recursive filters used by the pitch detector. Block in, block out.
import { flushDenormal } from './math';

/** 12 dB/octave Butterworth high-pass (RBJ cookbook biquad, transposed direct form II). */
export class BiquadHighpass {
  private readonly b0: number = 0;
  private readonly b1: number = 0;
  private readonly b2: number = 0;
  private readonly a1: number = 0;
  private readonly a2: number = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(cutoffHz: number, sampleRate: number) {
    const omega = (2 * Math.PI * cutoffHz) / sampleRate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / Math.SQRT2;
    const a0 = 1 + alpha;
    this.b0 = (1 + cosine) / 2 / a0;
    this.b1 = -(1 + cosine) / a0;
    this.b2 = (1 + cosine) / 2 / a0;
    this.a1 = (-2 * cosine) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  /** Filters `count` samples of `input`, starting at `inputOffset`, into `output[0..count)`. */
  processBlock(
    input: Float32Array,
    inputOffset: number,
    count: number,
    output: Float32Array,
  ): void {
    const { b0, b1, b2, a1, a2 } = this;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = 0; i < count; i++) {
      const sample = input[inputOffset + i]!;
      const filtered = b0 * sample + z1;
      z1 = b1 * sample - a1 * filtered + z2;
      z2 = b2 * sample - a2 * filtered;
      output[i] = filtered;
    }
    // States only decay toward the denormal range over thousands of silent samples, so
    // checking once per block is enough.
    this.z1 = flushDenormal(z1);
    this.z2 = flushDenormal(z2);
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}
