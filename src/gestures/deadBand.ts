/**
 * Swallows movements smaller than `width` so that hand tremor which survives the smoothing
 * filter does not wobble an audio parameter. The output only moves when the input pulls it
 * further than the band, and then follows at the band's edge (no steps).
 *
 * The band narrows to nothing at 0 and 1, so the ends of the range stay exactly reachable.
 */
export class DeadBand {
  private readonly width: number;
  private output: number | null = null;

  constructor(width: number) {
    this.width = width;
  }

  /** Feeds one value in 0..1 and returns the steadied value. */
  update(input: number): number {
    if (this.output === null) {
      this.output = input;
      return input;
    }
    const band = Math.max(0, Math.min(this.width, input, 1 - input));
    const offset = input - this.output;
    if (Math.abs(offset) > band) this.output = input - Math.sign(offset) * band;
    return this.output;
  }

  reset(): void {
    this.output = null;
  }
}
