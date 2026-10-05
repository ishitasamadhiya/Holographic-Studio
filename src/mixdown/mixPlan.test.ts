import { describe, expect, it } from 'vitest';
import { planMix } from './mixPlan';
import { audioManifest, videoManifest } from './testSupport';

describe('planMix', () => {
  it('audio mode: starts at the first captured frame and pulls the vocal earlier by its latency', () => {
    const plan = planMix(audioManifest(480_000, 0.025));
    expect(plan.backingStartFrame).toBe(0);
    expect(plan.vocalStartFrame).toBe(1200);
    // The last 25 ms of backing have no sung reply, so the output is that much shorter.
    expect(plan.outputFrames).toBe(480_000 - 1200);
    expect(plan.stemFrames).toBe(480_000);
    expect(plan.sampleRate).toBe(48000);
  });

  it('audio mode: a negative latency delays the vocal without trimming the output', () => {
    const plan = planMix(audioManifest(48_000, -0.01));
    expect(plan.vocalStartFrame).toBe(-480);
    expect(plan.outputFrames).toBe(48_000);
  });

  it('video mode, video started after the audio: both stems skip the lead-in', () => {
    const plan = planMix(videoManifest(480_000, 0.03, 0.5, 8));
    expect(plan.backingStartFrame).toBe(24_000);
    expect(plan.vocalStartFrame).toBe(24_000 + 1440);
    expect(plan.outputFrames).toBe(8 * 48_000);
  });

  it('video mode, video started before the audio: the output begins with silence', () => {
    const plan = planMix(videoManifest(480_000, 0.03, -0.25, 8));
    expect(plan.backingStartFrame).toBe(-12_000);
    expect(plan.vocalStartFrame).toBe(-12_000 + 1440);
    expect(plan.outputFrames).toBe(384_000);
  });

  it('video mode: the output is exactly as long as the video, whatever the audio length', () => {
    expect(planMix(videoManifest(10, 0, 0, 2.5)).outputFrames).toBe(120_000);
    expect(planMix(videoManifest(10_000_000, 0, 0, 2.5)).outputFrames).toBe(120_000);
  });

  it('rounds sub-sample offsets to the nearest frame', () => {
    // 10.4 and 10.6 samples of latency.
    expect(planMix(audioManifest(48_000, 10.4 / 48_000)).vocalStartFrame).toBe(10);
    expect(planMix(audioManifest(48_000, 10.6 / 48_000)).vocalStartFrame).toBe(11);
  });

  it('ignores a stray video block on an audio take', () => {
    const manifest = { ...videoManifest(48_000, 0.01, 0.5, 3), mode: 'audio' as const };
    const plan = planMix(manifest);
    expect(plan.backingStartFrame).toBe(0);
    expect(plan.outputFrames).toBe(48_000 - 480);
  });

  it('never plans a negative length', () => {
    expect(planMix(audioManifest(100, 1)).outputFrames).toBe(0);
  });

  it('refuses a video take without video timing', () => {
    const manifest = { ...audioManifest(48_000), mode: 'video' as const };
    expect(() => planMix(manifest)).toThrow(RangeError);
  });
});
