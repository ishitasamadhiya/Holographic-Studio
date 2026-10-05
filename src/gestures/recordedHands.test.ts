// Checks the gesture maths against real hands: landmarks the tracker produced for the photos
// in tests/e2e/fixtures/hands (see testing/recordedHands.ts).
import { describe, expect, it } from 'vitest';
import { measureHandConfidence, MIN_TRACKING_CONFIDENCE } from './confidence';
import { ExtraGestureDetector } from './extraGestures';
import { GesturePipeline } from './gesturePipeline';
import { sideFromLabel } from './handedness';
import { measureHandScale } from './handScale';
import { measureFingerExtensions, measureOpenness } from './openness';
import { RECORDED_HANDS, RECORDED_IMAGE_ASPECT } from './testing/recordedHands';
import type { GestureFrame, RawHand } from './types';

const FRAME_MS = 1000 / 30;

function replay(pipeline: GesturePipeline, hands: RawHand[], frames = 10): GestureFrame {
  let latest: GestureFrame | null = null;
  for (let index = 0; index < frames; index += 1) {
    latest = pipeline.update({
      timestampMs: index * FRAME_MS,
      imageAspect: RECORDED_IMAGE_ASPECT,
      hands,
    });
  }
  if (!latest) throw new Error('no frames replayed');
  return latest;
}

function meanY(hand: RawHand): number {
  return hand.landmarks.reduce((total, landmark) => total + landmark.y, 0) / hand.landmarks.length;
}

describe('recorded real hands', () => {
  it("the tracker's label is the person's actual hand in an un-mirrored image", () => {
    for (const [name, sample] of Object.entries(RECORDED_HANDS)) {
      expect(sideFromLabel(sample.hand.label), name).toBe(sample.actualSide);
    }
  });

  it('every recorded hand is a confident, complete detection', () => {
    for (const [name, sample] of Object.entries(RECORDED_HANDS)) {
      expect(sample.hand.landmarks, name).toHaveLength(21);
      expect(sample.hand.worldLandmarks, name).toHaveLength(21);
      expect(measureHandConfidence(sample.hand), name).toBeGreaterThan(MIN_TRACKING_CONFIDENCE);
    }
  });

  it('a fist is exactly 0', () => {
    expect(measureOpenness(RECORDED_HANDS.fist.hand)).toBe(0);
  });

  it('a thumbs-up is still a fist: the thumb alone does not open it', () => {
    expect(measureOpenness(RECORDED_HANDS.thumbUp.hand)).toBe(0);
  });

  it('open hands are exactly 1, flat or relaxed, palm or back, upright or sideways', () => {
    for (const name of [
      'openRight',
      'openLeft',
      'crossedUpperRight',
      'crossedLowerLeft',
      'twoLeftHandsImageLeft',
      'twoLeftHandsImageRight',
    ] as const) {
      expect(measureOpenness(RECORDED_HANDS[name].hand), name).toBe(1);
    }
  });

  it('partly open hands land in between, in order of how many fingers are out', () => {
    const oneFinger = measureOpenness(RECORDED_HANDS.pointingUp.hand);
    const twoFingers = measureOpenness(RECORDED_HANDS.victory.hand);
    expect(oneFinger).toBeGreaterThan(0.02);
    expect(oneFinger).toBeLessThan(0.3);
    expect(twoFingers).toBeGreaterThan(0.35);
    expect(twoFingers).toBeLessThan(0.8);
  });

  it('reads individual fingers correctly', () => {
    const pointing = measureFingerExtensions(RECORDED_HANDS.pointingUp.hand);
    expect(pointing).toEqual({ index: 1, middle: 0, ring: 0, pinky: 0 });

    const victory = measureFingerExtensions(RECORDED_HANDS.victory.hand);
    expect(victory.index).toBe(1);
    expect(victory.middle).toBe(1);
    expect(victory.ring).toBeLessThan(0.6);
    expect(victory.pinky).toBeLessThan(0.6);
  });

  it('measures the same size for the same hand turned upside down', () => {
    // left_hands.jpg shows one hand twice at the same distance, the second rotated by 180°.
    const upright = measureHandScale(
      RECORDED_HANDS.twoLeftHandsImageLeft.hand.landmarks,
      RECORDED_IMAGE_ASPECT,
    );
    const upsideDown = measureHandScale(
      RECORDED_HANDS.twoLeftHandsImageRight.hand.landmarks,
      RECORDED_IMAGE_ASPECT,
    );
    expect(upsideDown / upright).toBeGreaterThan(0.97);
    expect(upsideDown / upright).toBeLessThan(1.03);
  });

  it('measures a plausible palm size', () => {
    // The fist photo fills the frame height; its palm spans roughly a third of that.
    const scale = measureHandScale(RECORDED_HANDS.fist.hand.landmarks, RECORDED_IMAGE_ASPECT);
    expect(scale).toBeGreaterThan(0.28);
    expect(scale).toBeLessThan(0.38);
  });

  it('assigns crossed arms correctly: labels win over image position', () => {
    const upperRight = RECORDED_HANDS.crossedUpperRight.hand;
    const lowerLeft = RECORDED_HANDS.crossedLowerLeft.hand;
    const frame = replay(new GesturePipeline(), [lowerLeft, upperRight]);
    expect(frame.right.status).toBe('tracking');
    expect(frame.left.status).toBe('tracking');
    expect(frame.right.landmarks).toBe(upperRight.landmarks);
    expect(frame.left.landmarks).toBe(lowerLeft.landmarks);
    // The right hand really is the upper one in that photo.
    expect(meanY(upperRight)).toBeLessThan(meanY(lowerLeft));
    expect(frame.right.openness).toBe(1);
    expect(frame.left.openness).toBe(1);
  });

  it('separates two hands that the tracker gives the same label', () => {
    // Two left hands in one picture cannot both be the performer's left.
    const imageLeft = RECORDED_HANDS.twoLeftHandsImageLeft.hand;
    const imageRight = RECORDED_HANDS.twoLeftHandsImageRight.hand;
    const frame = replay(new GesturePipeline(), [imageLeft, imageRight]);
    expect(frame.right.landmarks).toBe(imageLeft.landmarks);
    expect(frame.left.landmarks).toBe(imageRight.landmarks);
  });

  it('recognises the real victory sign', () => {
    const pipeline = new GesturePipeline();
    const detector = new ExtraGestureDetector();
    const events: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const raw = {
        timestampMs: index * FRAME_MS,
        imageAspect: RECORDED_IMAGE_ASPECT,
        hands: [RECORDED_HANDS.victory.hand],
      };
      events.push(...detector.update(pipeline.update(raw), raw));
    }
    expect(events).toEqual(['toggle-reverb']);
  });

  it('does not mistake the other real poses for a victory sign', () => {
    for (const name of [
      'fist',
      'thumbUp',
      'pointingUp',
      'openRight',
      'crossedUpperRight',
    ] as const) {
      const pipeline = new GesturePipeline();
      const detector = new ExtraGestureDetector();
      for (let index = 0; index < 60; index += 1) {
        const raw = {
          timestampMs: index * FRAME_MS,
          imageAspect: RECORDED_IMAGE_ASPECT,
          hands: [RECORDED_HANDS[name].hand],
        };
        expect(detector.update(pipeline.update(raw), raw), name).toEqual([]);
      }
    }
  });
});
