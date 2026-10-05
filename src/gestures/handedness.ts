// Decides which detection is the performer's left hand and which is their right.
//
// The tracker labels every detection on every frame, but single labels are noisy, both hands
// sometimes get the same label, and detections arrive in no particular order. So each hand is
// followed from frame to frame by position and label votes are accumulated per followed hand.
// A new hand is given a side only once its votes agree, and a side, once given, is only taken
// away on strong, sustained evidence. When two hands' labels cannot tell them apart, image
// position decides, and that decision then follows the two hands wherever they move.
import { clamp01, type HandSide } from '@shared/controls';
import { measureHandConfidence, MIN_TRACKING_CONFIDENCE } from './confidence';
import { measureHandScale, palmCentre, type ImagePoint } from './handScale';
import { hasCompleteLandmarks } from './landmarkMath';
import type { RawHand, RawHandFrame } from './types';

/**
 * Which of the performer's own hands a tracker label means in an UN-MIRRORED camera image.
 *
 * The legacy "MediaPipe Hands" solution labelled hands as if the image were a mirrored selfie,
 * so its labels had to be swapped. The HandLandmarker task this app uses does not: run on the
 * un-mirrored photos in tests/e2e/fixtures/hands (whose true handedness is recorded in the
 * README there, and replayed by recordedHands.test.ts and the tracking end-to-end test) it reports
 * a person's right hand as 'Right'. Mirroring the frames before tracking would invert this.
 */
export function sideFromLabel(label: RawHand['label']): HandSide {
  return label === 'Right' ? 'right' : 'left';
}

/** A hand that is not seen for this long is forgotten; a later detection starts afresh. */
const TRACK_MEMORY_MS = 1000;
/** Farthest a palm centre may move between sightings and still be the same hand (image heights). */
const MAX_MATCH_DISTANCE = 0.4;
/** Label votes saturate here, so about ten opposite frames in a row are needed to overturn a hand. */
const EVIDENCE_LIMIT = 8;
/**
 * Evidence a new hand needs before it is given a side at all: two confident frames that agree.
 * Labels are at their least reliable just as a hand comes into view, and a hand put on the
 * wrong side for even a few frames moves the other hand's effects, which then take seconds to
 * settle back. Until then the hand is simply not reported.
 */
const SETTLE_EVIDENCE = 1.5;
/**
 * Vote strength (in either direction) after which a hand counts as clearly seen. Beside a
 * second hand that is enough to give it a side even if its own labels never agree, because
 * there is only one side left for it to be.
 */
const CLEARLY_SEEN = SETTLE_EVIDENCE;
/** Evidence against the current side needed before the hand is allowed to change sides. */
const FLIP_EVIDENCE = 2;
/**
 * When a newcomer carries the same label as a hand that already has its side, position decides
 * between them even if that moves the established hand to the other side. The newcomer must
 * have been in view this long first: its first labels are the least reliable of all, and a
 * newcomer whose labels are merely slow to settle should not swap the hands for a moment.
 * Meanwhile it is not reported.
 */
const NEWCOMER_GRACE_MS = 300;
/**
 * A detection whose palm centre lies within this many palm lengths of a larger detection's is
 * the same hand reported twice (the tracker does this now and then, a small second "hand"
 * inside the real one). Two real hands side by side are about a palm length apart or more.
 */
const DUPLICATE_DISTANCE = 0.5;

/** One hand followed across frames. */
interface Track {
  position: ImagePoint;
  firstSeenMs: number;
  lastSeenMs: number;
  /** Accumulated label votes: positive = the performer's right hand, negative = left. */
  evidence: number;
  /** Accumulated strength of those votes whichever way they went: how well the hand has been seen. */
  clarity: number;
  /** null until it has been settled which hand this is. */
  side: HandSide | null;
  /** The hand it was last told apart from, as a pair; that split stands while both are followed. */
  partner: Track | null;
}

interface Detection {
  hand: RawHand;
  position: ImagePoint;
  /** Palm size (see measureHandScale); 0 when it cannot be measured. */
  scale: number;
  /** This frame's label as a signed vote, weighted by how sure the tracker is (0.5 = a coin toss). */
  vote: number;
}

export interface HandAssignment {
  side: HandSide;
  hand: RawHand;
}

/** The tracker's certainty about a detection's label; 0 when it did not report a usable number. */
function labelScore(hand: RawHand): number {
  return Number.isFinite(hand.score) ? hand.score : 0;
}

function toDetection(hand: RawHand, imageAspect: number): Detection {
  const direction = sideFromLabel(hand.label) === 'right' ? 1 : -1;
  // A detection too unreliable to move the controls (part of the hand outside the picture) has
  // no say in whose hand it is either. An unsure label on a hand in full view does vote, with
  // a weight that falls to nothing at a coin toss (score 0.5).
  const trusted = measureHandConfidence(hand) >= MIN_TRACKING_CONFIDENCE;
  const scale = measureHandScale(hand.landmarks, imageAspect);
  return {
    hand,
    position: palmCentre(hand.landmarks, imageAspect),
    scale: Number.isFinite(scale) ? scale : 0,
    vote: trusted ? direction * clamp01(2 * labelScore(hand) - 1) : 0,
  };
}

function distanceBetween(a: ImagePoint, b: ImagePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function gap(track: Track, detection: Detection): number {
  return distanceBetween(track.position, detection.position);
}

/** The detections, in their original order, without any that sit inside a larger one. */
function withoutDuplicates(detections: readonly Detection[]): Detection[] {
  const kept: Detection[] = [];
  for (const detection of [...detections].sort((a, b) => b.scale - a.scale)) {
    const insideLarger = kept.some(
      (larger) =>
        distanceBetween(larger.position, detection.position) < DUPLICATE_DISTANCE * larger.scale,
    );
    if (!insideLarger) kept.push(detection);
  }
  return detections.filter((detection) => kept.includes(detection));
}

function oppositeSide(side: HandSide): HandSide {
  return side === 'right' ? 'left' : 'right';
}

/**
 * The side this hand's labels argue for, with hysteresis around the side it already has.
 * null while a new hand's labels have not yet made a case for either side.
 */
function preferredSide(track: Track): HandSide | null {
  const labelled: HandSide = track.evidence >= 0 ? 'right' : 'left';
  const strength = Math.abs(track.evidence);
  if (track.side === null) return strength >= SETTLE_EVIDENCE ? labelled : null;
  if (track.side === labelled) return labelled;
  return strength >= FLIP_EVIDENCE ? labelled : track.side;
}

/** Gives two hands opposite sides and remembers that they were told apart as a pair. */
function split(track: Track, side: HandSide, other: Track): void {
  track.side = side;
  other.side = oppositeSide(side);
  track.partner = other;
  other.partner = track;
}

/** Decides the sides of two hands that are in view together. */
function settlePair(first: Track, second: Track, nowMs: number): void {
  const firstWants = preferredSide(first);
  const secondWants = preferredSide(second);
  if (firstWants !== null && secondWants !== null && firstWants !== secondWants) {
    split(first, firstWants, second);
    return;
  }

  // From here on the labels do not tell the two apart: they agree, or say nothing yet.
  if (first.clarity < CLEARLY_SEEN || second.clarity < CLEARLY_SEEN) {
    // A hand that has barely been seen waits, and until it has been it does not disturb the
    // other, which goes by its own labels as if it were alone.
    if (firstWants !== null) first.side = firstWants;
    if (secondWants !== null) second.side = secondWants;
    return;
  }
  // These two were already told apart. Each has been followed by position since, so the split
  // stays right even while the hands cross, where sorting them by position again would not.
  if (first.partner === second && second.partner === first) return;

  // Only one of the two has labels that make a case; the other is whatever that leaves.
  if (firstWants !== null && secondWants === null) {
    split(first, firstWants, second);
    return;
  }
  if (secondWants !== null && firstWants === null) {
    split(second, secondWants, first);
    return;
  }

  // Both labels name the same hand, or neither names any: position decides. The camera image is
  // not mirrored, so unless the arms are crossed the performer's right hand is the one nearer
  // the image's left edge.
  const [rightHand, leftHand] =
    first.position.x <= second.position.x ? [first, second] : [second, first];
  const newcomer = first.side === null ? first : second.side === null ? second : null;
  const moves = rightHand.side === 'left' || leftHand.side === 'right';
  if (newcomer && moves && nowMs - newcomer.firstSeenMs < NEWCOMER_GRACE_MS) return;
  split(rightHand, 'right', leftHand);
}

/** For each detection, the already-followed hand it continues (or undefined for a new hand). */
function matchDetections(
  tracks: readonly Track[],
  detections: readonly Detection[],
): Array<Track | undefined> {
  const [firstTrack, secondTrack] = tracks;
  const [firstDetection, secondDetection] = detections;
  const ifInReach = (track: Track, detection: Detection): Track | undefined =>
    gap(track, detection) <= MAX_MATCH_DISTANCE ? track : undefined;

  if (firstTrack && secondTrack && firstDetection && secondDetection) {
    // Two hands, two detections: take the pairing with the smaller total movement. Matching
    // each detection to its nearest hand independently would swap two hands that both moved
    // the same way.
    const straight = gap(firstTrack, firstDetection) + gap(secondTrack, secondDetection);
    const crossed = gap(firstTrack, secondDetection) + gap(secondTrack, firstDetection);
    return straight <= crossed
      ? [ifInReach(firstTrack, firstDetection), ifInReach(secondTrack, secondDetection)]
      : [ifInReach(secondTrack, firstDetection), ifInReach(firstTrack, secondDetection)];
  }

  // Otherwise one side has at most one member: the closest pair wins, the rest are unmatched.
  let best: { track: Track; detectionIndex: number; distance: number } | undefined;
  for (const [detectionIndex, detection] of detections.entries()) {
    for (const track of tracks) {
      const distance = gap(track, detection);
      if (distance <= MAX_MATCH_DISTANCE && (!best || distance < best.distance)) {
        best = { track, detectionIndex, distance };
      }
    }
  }
  const winner = best;
  return detections.map((_, index) =>
    winner?.detectionIndex === index ? winner.track : undefined,
  );
}

export class HandednessResolver {
  private tracks: Track[] = [];

  /**
   * Labels the hands of one frame. Returns at most one hand per side; when the tracker reports
   * more than two hands only the two it is surest of are used, and a detection inside a larger
   * one is dropped as a duplicate. A hand that has only just come into view is left out until
   * its labels have settled which hand it is (two confident, agreeing frames), or, if it shares
   * its label with a hand that position would then move to the other side, for NEWCOMER_GRACE_MS.
   */
  assign(frame: RawHandFrame): HandAssignment[] {
    const nowMs = frame.timestampMs;
    this.tracks = this.tracks.filter((track) => nowMs - track.lastSeenMs <= TRACK_MEMORY_MS);

    const detections = withoutDuplicates(
      frame.hands.filter(hasCompleteLandmarks).map((hand) => toDetection(hand, frame.imageAspect)),
    )
      .sort((a, b) => labelScore(b.hand) - labelScore(a.hand))
      .slice(0, 2);

    const seen = this.follow(detections, nowMs);
    this.settleSides(seen, nowMs);
    return detections.flatMap((detection, index) => {
      const side = seen[index]?.side ?? null;
      return side === null ? [] : [{ side, hand: detection.hand }];
    });
  }

  reset(): void {
    this.tracks = [];
  }

  /** Continues or starts a track for every detection and folds in this frame's label votes. */
  private follow(detections: readonly Detection[], nowMs: number): Track[] {
    const matches = matchDetections(this.tracks, detections);
    const seen = detections.map((detection, index) => {
      const track: Track = matches[index] ?? {
        position: detection.position,
        firstSeenMs: nowMs,
        lastSeenMs: nowMs,
        evidence: 0,
        clarity: 0,
        side: null,
        partner: null,
      };
      track.position = detection.position;
      track.lastSeenMs = nowMs;
      track.evidence = Math.max(
        -EVIDENCE_LIMIT,
        Math.min(EVIDENCE_LIMIT, track.evidence + detection.vote),
      );
      track.clarity = Math.min(EVIDENCE_LIMIT, track.clarity + Math.abs(detection.vote));
      return track;
    });

    // There are only two hands: the ones in view come first, then the most recently seen.
    const unseen = this.tracks
      .filter((track) => !seen.includes(track))
      .sort((a, b) => b.lastSeenMs - a.lastSeenMs);
    this.tracks = [...seen, ...unseen].slice(0, 2);
    return seen;
  }

  private settleSides(seen: readonly Track[], nowMs: number): void {
    const [first, second] = seen;
    if (first && second) {
      settlePair(first, second, nowMs);
      return;
    }
    if (first) {
      // While its partner is still remembered, a lone hand keeps the side it was given as part
      // of that pair; otherwise the partner flickering in and out would flip it back and forth.
      const partner = this.tracks.find((track) => track !== first);
      const heldByPair =
        first.side !== null &&
        partner !== undefined &&
        partner.side !== null &&
        partner.side !== first.side;
      if (!heldByPair) first.side = preferredSide(first);
    }
  }
}
