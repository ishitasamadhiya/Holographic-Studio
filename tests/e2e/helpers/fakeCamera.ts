import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const handFixturesDir = resolve(__dirname, '../fixtures/hands');

/** Absolute path of a photo in tests/e2e/fixtures/hands. */
export function handFixture(fileName: string): string {
  return join(handFixturesDir, fileName);
}

/** A rectangle inside a photo, as fractions (0..1) of its width and height. */
export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One stretch of the synthetic camera feed. */
export interface CameraScene {
  /** Photo to show; leave out for an empty scene with nothing in view. */
  image?: string;
  /** Part of the photo to show (e.g. one of two hands). Defaults to the whole photo. */
  crop?: CropRegion;
  /**
   * How much of the camera frame the photo may fill, 0..1. Defaults to 1 (as large as fits).
   * Halving it is the same as the subject moving twice as far from the camera.
   */
  size?: number;
  seconds: number;
}

export interface FakeCameraClip {
  /** Pass as `fakeVideo` to launchApp. Chromium plays it in a loop. */
  path: string;
  /** Deletes the temporary clip. */
  dispose: () => void;
}

const CAMERA_WIDTH = 1280;
const CAMERA_HEIGHT = 720;
const CAMERA_FPS = 30;
const BACKDROP = '0x808080';

function sceneInput(scene: CameraScene): string[] {
  if (!scene.image) {
    const backdrop = `color=c=${BACKDROP}:s=${CAMERA_WIDTH}x${CAMERA_HEIGHT}:r=${CAMERA_FPS}`;
    return ['-f', 'lavfi', '-t', String(scene.seconds), '-i', backdrop];
  }
  return [
    '-loop',
    '1',
    '-framerate',
    String(CAMERA_FPS),
    '-t',
    String(scene.seconds),
    '-i',
    scene.image,
  ];
}

/** Fits the (optionally cropped) photo inside the camera frame without stretching it. */
function sceneFilter(scene: CameraScene, index: number): string {
  const steps: string[] = [];
  if (scene.crop) {
    const { x, y, width, height } = scene.crop;
    steps.push(`crop=iw*${width}:ih*${height}:iw*${x}:ih*${y}`);
  }
  const size = scene.size ?? 1;
  const boxWidth = Math.round(CAMERA_WIDTH * size);
  const boxHeight = Math.round(CAMERA_HEIGHT * size);
  steps.push(
    `scale=${boxWidth}:${boxHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    `pad=${CAMERA_WIDTH}:${CAMERA_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=${BACKDROP}`,
    'setsar=1',
    `fps=${CAMERA_FPS}`,
    'format=yuvj420p',
  );
  return `[${index}:v]${steps.join(',')}[scene${index}]`;
}

/**
 * Renders the scenes, one after another, into a short Motion-JPEG clip that Chromium's
 * synthetic camera can play (--use-file-for-fake-video-capture). The clip is built at test
 * time with the bundled FFmpeg so that no video has to live in the repository.
 */
export function createFakeCameraClip(scenes: CameraScene[]): FakeCameraClip {
  if (!ffmpegPath) throw new Error('The bundled FFmpeg binary is missing; run npm install.');
  if (scenes.length === 0) throw new Error('A camera clip needs at least one scene.');

  const folder = mkdtempSync(join(tmpdir(), 'holo-fake-camera-'));
  const path = join(folder, 'camera.mjpeg');
  const sceneLabels = scenes.map((_, index) => `[scene${index}]`).join('');
  const filterGraph = [
    ...scenes.map(sceneFilter),
    `${sceneLabels}concat=n=${scenes.length}:v=1:a=0[camera]`,
  ].join(';');

  try {
    execFileSync(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        ...scenes.flatMap(sceneInput),
        '-filter_complex',
        filterGraph,
        '-map',
        '[camera]',
        '-c:v',
        'mjpeg',
        '-q:v',
        '4',
        '-f',
        'mjpeg',
        path,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }

  return { path, dispose: () => rmSync(folder, { recursive: true, force: true }) };
}
