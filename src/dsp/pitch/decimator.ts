// Low-pass filtering for the pitch detector's decimated analysis signal.

/**
 * Hamming-windowed-sinc low-pass FIR with unity gain at DC.
 * `cutoff` is the -6 dB frequency as a fraction of the sample rate (0..0.5).
 */
export function designLowpassFir(tapCount: number, cutoff: number): Float32Array {
  const taps = new Float32Array(tapCount);
  const center = (tapCount - 1) / 2;
  let sum = 0;
  for (let i = 0; i < tapCount; i++) {
    const n = i - center;
    const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    const window = tapCount > 1 ? 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (tapCount - 1)) : 1;
    taps[i] = sinc * window;
    sum += sinc * window;
  }
  for (let i = 0; i < tapCount; i++) taps[i] = taps[i]! / sum;
  return taps;
}
