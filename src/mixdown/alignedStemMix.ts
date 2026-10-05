import { STEM_CHANNELS } from '@shared/take';
import type { MixPlan } from './mixPlan';
import { StemReader } from './stemReader';

/** The latency-compensated sum of the vocal and backing stems on the export timeline. */
export class AlignedStemMix {
  private scratch = new Float32Array(0);

  private constructor(
    private readonly vocal: StemReader,
    private readonly backing: StemReader,
    private readonly plan: MixPlan,
  ) {}

  static async open(
    vocalPath: string,
    backingPath: string,
    plan: MixPlan,
  ): Promise<AlignedStemMix> {
    const vocal = await StemReader.open(vocalPath, plan.stemFrames);
    try {
      const backing = await StemReader.open(backingPath, plan.stemFrames);
      return new AlignedStemMix(vocal, backing, plan);
    } catch (error) {
      await vocal.close();
      throw error;
    }
  }

  /** Fills `target` (interleaved stereo) with output frames [startFrame, startFrame + frameCount). */
  async read(startFrame: number, frameCount: number, target: Float32Array): Promise<void> {
    const sampleCount = frameCount * STEM_CHANNELS;
    if (this.scratch.length < sampleCount) this.scratch = new Float32Array(sampleCount);
    const backing = this.scratch;

    await this.vocal.read(this.plan.vocalStartFrame + startFrame, frameCount, target);
    await this.backing.read(this.plan.backingStartFrame + startFrame, frameCount, backing);

    for (let index = 0; index < sampleCount; index++) {
      // Rounded to float32 before the check, because that is how it is stored: two large
      // samples can add up to a finite double that still becomes Infinity in the array.
      const sum = Math.fround(target[index]! + backing[index]!);
      // A NaN or Infinity would poison the loudness measurement and the limiter.
      target[index] = Number.isFinite(sum) ? sum : 0;
    }
  }

  async close(): Promise<void> {
    await Promise.all([this.vocal.close(), this.backing.close()]);
  }
}
