import { STEM_CHANNELS } from '@shared/take';

/**
 * Applies a short raised-cosine fade-in at the very start of the programme and a fade-out at
 * the very end, so audio that begins or ends mid-waveform does not click.
 * `block` holds output frames [blockStartFrame, blockStartFrame + frameCount).
 */
export function applyEdgeFades(
  block: Float32Array,
  frameCount: number,
  blockStartFrame: number,
  totalFrames: number,
  fadeFrames: number,
): void {
  const fade = Math.min(fadeFrames, Math.floor(totalFrames / 2));
  if (fade <= 0) return;
  const blockEndFrame = blockStartFrame + frameCount;
  if (blockStartFrame >= fade && blockEndFrame <= totalFrames - fade) return;

  for (let frame = 0; frame < frameCount; frame++) {
    const position = blockStartFrame + frame;
    const framesFromEdge = Math.min(position, totalFrames - 1 - position);
    if (framesFromEdge >= fade) continue;
    const gain = 0.5 - 0.5 * Math.cos((Math.PI * framesFromEdge) / fade);
    for (let channel = 0; channel < STEM_CHANNELS; channel++) {
      const index = frame * STEM_CHANNELS + channel;
      block[index] = block[index]! * gain;
    }
  }
}
