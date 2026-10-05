// Hand tracking in the real app: MediaPipe in a worker, fed by Chromium's synthetic camera
// playing clips made from the photos in fixtures/hands (see the README there for what each
// photo shows and which of the person's hands it is).
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { launchApp } from './helpers/app';
import {
  createFakeCameraClip,
  handFixture,
  type CameraScene,
  type CropRegion,
} from './helpers/fakeCamera';

type HandStatus = 'tracking' | 'holding' | 'lost';
type ControlStatus = 'gesture' | 'holding' | 'returning' | 'manual';
type ControlId = 'autotune' | 'echo' | 'volume';

interface Point {
  x: number;
  y: number;
  z: number;
}

interface HandSnapshot {
  status: HandStatus;
  openness: number;
  proximity: number;
  scale: number;
  confidence: number;
  landmarks: Point[] | null;
}

/** The parts of window.__trackingProbe (src/renderer/src/dev/trackingProbe.ts) used here. */
interface TrackingProbe {
  frames: number;
  lastRaw: {
    imageAspect: number;
    hands: Array<{ label: string; score: number; landmarks: Point[]; worldLandmarks: Point[] }>;
  } | null;
  lastGesture: { timestampMs: number; left: HandSnapshot; right: HandSnapshot } | null;
  inferenceMs: number;
  error: string | null;
  delegate: 'GPU' | 'CPU' | null;
  controls: {
    values: Record<ControlId, number>;
    status: Record<ControlId, ControlStatus>;
  } | null;
  extraGestures: string[];
}

interface ProbeWindow {
  __trackingProbe: TrackingProbe;
}

/** One observation of the probe while a timeline is being recorded. */
interface TimelineSample {
  timeMs: number;
  left: HandStatus;
  right: HandStatus;
  rightOpenness: number;
  rightProximity: number;
  rightScale: number;
  autotune: number;
  autotuneStatus: ControlStatus;
  echoStatus: ControlStatus;
}

/** The probe resolves controls with the default settings, so a lost hand's control rests here. */
const SLIDERS = {
  autotune: DEFAULT_SETTINGS.controls.autotune.manual,
  echo: DEFAULT_SETTINGS.controls.echo.manual,
  volume: DEFAULT_SETTINGS.controls.volume.manual,
};

const LEFT_HALF: CropRegion = { x: 0, y: 0, width: 0.5, height: 1 };
const RIGHT_HALF: CropRegion = { x: 0.5, y: 0, width: 0.5, height: 1 };

/** Opens the tracking probe with the given camera scenes (none = Chromium's default test pattern). */
async function withProbe(
  scenes: CameraScene[] | null,
  body: (page: Page) => Promise<void>,
  pageQuery = '',
): Promise<void> {
  const clip = scenes ? createFakeCameraClip(scenes) : null;
  try {
    const { page, close } = await launchApp({
      page: `tracking-probe.html${pageQuery}`,
      ...(clip ? { fakeVideo: clip.path } : {}),
    });
    try {
      await page.waitForFunction(
        () => {
          const probe = (window as unknown as ProbeWindow).__trackingProbe;
          return probe.frames > 0 || probe.error !== null;
        },
        undefined,
        { timeout: 30_000 },
      );
      await body(page);
    } finally {
      await close();
    }
  } finally {
    clip?.dispose();
  }
}

function readProbe(page: Page): Promise<TrackingProbe> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__trackingProbe);
}

async function waitForTracking(page: Page, sides: Array<'left' | 'right'>): Promise<void> {
  await page.waitForFunction(
    (wanted) => {
      const gesture = (window as unknown as ProbeWindow).__trackingProbe.lastGesture;
      return gesture !== null && wanted.every((side) => gesture[side].status === 'tracking');
    },
    sides,
    { timeout: 20_000 },
  );
}

/** Tracker results per second, counted over `durationMs`. */
async function measureFrameRate(page: Page, durationMs: number): Promise<number> {
  const count = (): Promise<{ frames: number; atMs: number }> =>
    page.evaluate(() => ({
      frames: (window as unknown as ProbeWindow).__trackingProbe.frames,
      atMs: performance.now(),
    }));
  const before = await count();
  await page.waitForTimeout(durationMs);
  const after = await count();
  return ((after.frames - before.frames) / (after.atMs - before.atMs)) * 1000;
}

/** Samples the probe about every 30 ms for `durationMs`, inside the page. */
function recordTimeline(page: Page, durationMs: number): Promise<TimelineSample[]> {
  return page.evaluate(
    (duration) =>
      new Promise<TimelineSample[]>((resolve) => {
        const probe = (window as unknown as ProbeWindow).__trackingProbe;
        const samples: TimelineSample[] = [];
        const startedAt = performance.now();
        const timer = window.setInterval(() => {
          const timeMs = performance.now() - startedAt;
          const { lastGesture: gesture, controls } = probe;
          if (gesture && controls) {
            samples.push({
              timeMs,
              left: gesture.left.status,
              right: gesture.right.status,
              rightOpenness: gesture.right.openness,
              rightProximity: gesture.right.proximity,
              rightScale: gesture.right.scale,
              autotune: controls.values.autotune,
              autotuneStatus: controls.status.autotune,
              echoStatus: controls.status.echo,
            });
          }
          if (timeMs >= duration) {
            window.clearInterval(timer);
            resolve(samples);
          }
        }, 30);
      }),
    durationMs,
  );
}

function meanY(points: Point[] | null): number {
  if (!points || points.length === 0) return Number.NaN;
  return points.reduce((total, point) => total + point.y, 0) / points.length;
}

/** Time at which `predicate` first holds at or after `fromMs`, or NaN. */
function firstTime(
  timeline: TimelineSample[],
  fromMs: number,
  predicate: (sample: TimelineSample) => boolean,
): number {
  const sample = timeline.find((candidate) => candidate.timeMs >= fromMs && predicate(candidate));
  return sample ? sample.timeMs : Number.NaN;
}

test('tracks an open right hand in a worker at a usable frame rate', async () => {
  const scene = { image: handFixture('right_hands.jpg'), crop: RIGHT_HALF, seconds: 2 };
  await withProbe([scene], async (page) => {
    await waitForTracking(page, ['right']);

    // Inference runs in a dedicated worker, not on the UI thread.
    const workerUrls = page.workers().map((worker) => worker.url());
    expect(workerUrls.some((url) => url.includes('handLandmarker.worker'))).toBe(true);

    const framesPerSecond = await measureFrameRate(page, 3000);
    const probe = await readProbe(page);
    console.log(
      `open right hand: ${framesPerSecond.toFixed(1)} fps, inference ${probe.inferenceMs.toFixed(1)} ms (${probe.delegate})`,
    );
    expect(framesPerSecond).toBeGreaterThanOrEqual(10);
    expect(probe.error).toBeNull();
    expect(probe.delegate).not.toBeNull();
    expect(probe.inferenceMs).toBeGreaterThan(0);
    expect(probe.inferenceMs).toBeLessThan(200);

    expect(probe.lastRaw?.hands).toHaveLength(1);
    expect(probe.lastRaw?.imageAspect).toBeCloseTo(16 / 9, 2);
    expect(probe.lastRaw?.hands[0]?.landmarks).toHaveLength(21);
    expect(probe.lastRaw?.hands[0]?.worldLandmarks).toHaveLength(21);

    // The photo shows a right hand, wide open.
    expect(probe.lastGesture?.right.status).toBe('tracking');
    expect(probe.lastGesture?.right.openness).toBeGreaterThan(0.95);
    expect(probe.lastGesture?.right.confidence).toBeGreaterThan(0.7);
    expect(probe.lastGesture?.left.status).toBe('lost');
    // Right-hand openness drives the autotune control.
    expect(probe.controls?.status.autotune).toBe('gesture');
    expect(probe.controls?.values.autotune).toBeGreaterThan(0.95);
  });
});

test('reports an open left hand as the left hand', async () => {
  const scene = { image: handFixture('left_hands.jpg'), crop: LEFT_HALF, seconds: 2 };
  await withProbe([scene], async (page) => {
    await waitForTracking(page, ['left']);
    await page.waitForTimeout(500);
    const probe = await readProbe(page);
    expect(probe.error).toBeNull();
    expect(probe.lastGesture?.left.status).toBe('tracking');
    expect(probe.lastGesture?.left.openness).toBeGreaterThan(0.95);
    expect(probe.lastGesture?.right.status).toBe('lost');
    // Left-hand openness drives the echo control.
    expect(probe.controls?.status.echo).toBe('gesture');
    expect(probe.controls?.values.echo).toBeGreaterThan(0.95);
  });
});

test('reads a fist as closed, and its size as distance', async () => {
  // The same right fist, first far (half size) and then near (full size), over and over.
  const fist = handFixture('fist.jpg');
  const scenes = [
    { image: fist, size: 0.45, seconds: 2.5 },
    { image: fist, size: 0.9, seconds: 2.5 },
  ];
  await withProbe(scenes, async (page) => {
    await waitForTracking(page, ['right']);
    const timeline = await recordTimeline(page, 6000);
    const tracked = timeline.filter((sample) => sample.right === 'tracking');
    expect(tracked.length).toBeGreaterThan(100);

    // A fist: openness (almost) exactly 0 the whole time, and never the left hand.
    for (const sample of tracked) expect(sample.rightOpenness).toBeLessThan(0.05);
    expect(timeline.every((sample) => sample.left === 'lost')).toBe(true);

    // Twice as large in the image ⇒ twice the hand scale ⇒ half a unit of proximity.
    const scales = tracked.map((sample) => sample.rightScale);
    const sizeRatio = Math.max(...scales) / Math.min(...scales);
    const proximities = tracked.map((sample) => sample.rightProximity);
    const proximitySpan = Math.max(...proximities) - Math.min(...proximities);
    console.log(
      `fist near/far: scale ratio ${sizeRatio.toFixed(2)}, proximity span ${proximitySpan.toFixed(2)}`,
    );
    expect(sizeRatio).toBeGreaterThan(1.8);
    expect(sizeRatio).toBeLessThan(2.2);
    expect(proximitySpan).toBeGreaterThan(0.4);
    expect(proximitySpan).toBeLessThan(0.6);
  });
});

test('tells crossed hands apart, holds them when they vanish, then gives them up as lost', async () => {
  // Two open hands with the arms crossed (her right hand is the upper one), then an empty scene.
  const scenes = [{ image: handFixture('woman_hands.jpg'), seconds: 3 }, { seconds: 4 }];
  await withProbe(scenes, async (page) => {
    await waitForTracking(page, ['left', 'right']);
    const probe = await readProbe(page);
    expect(probe.lastRaw?.hands).toHaveLength(2);
    expect(probe.lastGesture?.right.openness).toBeGreaterThan(0.95);
    expect(probe.lastGesture?.left.openness).toBeGreaterThan(0.95);
    // Image y grows downward: the performer's right hand must be the upper one.
    expect(meanY(probe.lastGesture?.right.landmarks ?? null)).toBeLessThan(
      meanY(probe.lastGesture?.left.landmarks ?? null),
    );

    const timeline = await recordTimeline(page, 9000);

    // Both hands: tracking → holding for about 0.8 s → lost.
    const vanishedAt = firstTime(timeline, 0, (sample) => sample.right === 'holding');
    const lostAt = firstTime(timeline, vanishedAt, (sample) => sample.right === 'lost');
    expect(vanishedAt).toBeGreaterThan(0);
    expect(lostAt - vanishedAt).toBeGreaterThan(550);
    expect(lostAt - vanishedAt).toBeLessThan(1100);
    const leftVanishedAt = firstTime(timeline, 0, (sample) => sample.left === 'holding');
    const leftLostAt = firstTime(timeline, leftVanishedAt, (sample) => sample.left === 'lost');
    expect(Math.abs(leftVanishedAt - vanishedAt)).toBeLessThan(200);
    expect(leftLostAt - leftVanishedAt).toBeGreaterThan(550);
    expect(leftLostAt - leftVanishedAt).toBeLessThan(1100);
    console.log(`hands vanish: held for ${(lostAt - vanishedAt).toFixed(0)} ms before lost`);

    // The control: frozen while holding, then eases to its slider and rests there…
    // (The probe resolves controls once per display frame, so they trail the hand status by
    // a few milliseconds; the edges of the window are left out.)
    const whileHeld = timeline.filter(
      (sample) => sample.timeMs >= vanishedAt + 60 && sample.timeMs < lostAt - 60,
    );
    expect(whileHeld.length).toBeGreaterThan(10);
    for (const sample of whileHeld) {
      expect(sample.autotuneStatus).toBe('holding');
      expect(sample.autotune).toBeGreaterThan(0.95);
    }
    const returningAt = firstTime(timeline, vanishedAt, (s) => s.autotuneStatus === 'returning');
    const manualAt = firstTime(timeline, returningAt, (s) => s.autotuneStatus === 'manual');
    expect(manualAt - returningAt).toBeGreaterThan(1200);
    expect(manualAt - returningAt).toBeLessThan(1800);
    expect(timeline.find((sample) => sample.timeMs >= manualAt)?.autotune).toBe(SLIDERS.autotune);
    expect(firstTime(timeline, vanishedAt, (s) => s.echoStatus === 'manual')).toBeGreaterThan(0);

    // …and blends back onto the hand when the clip loops and the hands reappear.
    const backAt = firstTime(timeline, manualAt, (sample) => sample.autotuneStatus === 'gesture');
    expect(backAt).toBeGreaterThan(manualAt);
    const settled = timeline.filter((sample) => sample.timeMs >= backAt + 500);
    expect(settled.length).toBeGreaterThan(0);
    for (const sample of settled) expect(sample.autotune).toBeGreaterThan(0.95);

    // Nowhere in all of that did the control jump.
    let largestStep = 0;
    for (let index = 1; index < timeline.length; index += 1) {
      const step = Math.abs(
        (timeline[index]?.autotune ?? 0) - (timeline[index - 1]?.autotune ?? 0),
      );
      largestStep = Math.max(largestStep, step);
    }
    expect(largestStep).toBeLessThan(0.3);
  });
});

test('with no hand in view both hands stay lost and the controls stay on their sliders', async () => {
  await withProbe(null, async (page) => {
    const timeline = await recordTimeline(page, 3000);
    const framesPerSecond = await measureFrameRate(page, 1000);
    const probe = await readProbe(page);
    console.log(
      `no hands: ${framesPerSecond.toFixed(1)} fps, inference ${probe.inferenceMs.toFixed(1)} ms`,
    );

    expect(probe.error).toBeNull();
    expect(probe.frames).toBeGreaterThan(30);
    expect(framesPerSecond).toBeGreaterThanOrEqual(10);
    expect(probe.lastRaw?.hands).toEqual([]);
    expect(timeline.length).toBeGreaterThan(50);
    for (const sample of timeline) {
      expect(sample.left).toBe('lost');
      expect(sample.right).toBe('lost');
      expect(sample.autotuneStatus).toBe('manual');
    }
    expect(probe.controls?.values).toEqual(SLIDERS);
    expect(probe.extraGestures).toEqual([]);
  });
});

test('runs on the CPU when asked to, and recognises a held victory sign', async () => {
  const scene = { image: handFixture('victory.jpg'), seconds: 2 };
  await withProbe(
    [scene],
    async (page) => {
      await page.waitForFunction(
        () => (window as unknown as ProbeWindow).__trackingProbe.extraGestures.length > 0,
        undefined,
        { timeout: 20_000 },
      );
      const framesPerSecond = await measureFrameRate(page, 1500);
      const probe = await readProbe(page);
      console.log(
        `victory on CPU: ${framesPerSecond.toFixed(1)} fps, inference ${probe.inferenceMs.toFixed(1)} ms`,
      );
      expect(probe.error).toBeNull();
      expect(probe.delegate).toBe('CPU');
      expect(framesPerSecond).toBeGreaterThan(3);
      expect(probe.lastGesture?.right.status).toBe('tracking');
      // Held continuously, the sign toggles once and only once.
      expect(probe.extraGestures).toEqual(['toggle-reverb']);
    },
    '?delegate=cpu',
  );
});
