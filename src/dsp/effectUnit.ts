/**
 * One stage of the vocal chain. Units are run in order on the same pair of buffers, so adding
 * an effect (doubling, harmony, a creative pitch shift…) means writing one of these and
 * inserting it into the chain's unit list.
 *
 * Real-time contract: `process` runs on the audio thread. It must not allocate, must be
 * deterministic, and its result must not depend on how the stream is cut into blocks.
 *
 * "Must not allocate" includes the allocations a JavaScript engine makes behind the scenes.
 * V8 keeps a fractional number that is not in a typed array or an optimized local variable
 * as a small heap object, so two habits are followed throughout this folder:
 *
 *   - Audio and per-sample parameters travel between functions in Float32Arrays, never as
 *     one number per call (each fractional argument or return value would be a heap object).
 *   - Every numeric class field has a numeric initializer where it is declared (`= 0`), even
 *     when the constructor assigns the real value. A field that starts out `undefined` is
 *     stored as a generic pointer for good, and every fractional value later written to it,
 *     or read from it into a loop variable, is allocated afresh.
 *
 * One exception is kept on purpose: the autotune's once-per-estimate bookkeeping (200 times a
 * second) passes a few fractional values as ordinary arguments and return values. In Node 22
 * that boxes about 10–14 KB of numbers per second, which costs one ~0.2 ms young-generation
 * collection every minute or two (the block budget is 2.67 ms). Routing those values through
 * fields would remove it at a real cost in readability.
 */
export interface EffectUnit {
  /** Delay this unit adds between its input and its output, in samples. */
  readonly latencySamples: number;
  /** Processes the first `frameCount` frames of both channels in place. */
  process(left: Float32Array, right: Float32Array, frameCount: number): void;
  /** Clears all audio state (delay lines, filters); parameter targets are kept. */
  reset(): void;
}
