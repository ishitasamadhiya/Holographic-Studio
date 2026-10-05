import { describe, expect, it } from 'vitest';
import { ffmpegPath } from '../../../tests/e2e/helpers/takeFixtures';
import { runFfmpeg } from './ffmpegProcess';

/** Renders a test pattern to nowhere: real work for FFmpeg, no files. */
function nullEncodeArgs(seconds: number): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-progress',
    'pipe:1',
    '-nostats',
    '-stats_period',
    '0.1',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=1280x720:r=30:d=${seconds}`,
    '-f',
    'null',
    '-',
  ];
}

describe('runFfmpeg', () => {
  it('reports a successful run and its progress in seconds of output', async () => {
    const progress: number[] = [];
    const outcome = await runFfmpeg({
      ffmpegPath,
      args: nullEncodeArgs(20),
      onOutputSeconds: (seconds) => progress.push(seconds),
    });
    expect(outcome).toEqual({ status: 'completed' });
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toBeCloseTo(20, 0);
    for (let index = 1; index < progress.length; index++) {
      expect(progress[index]!).toBeGreaterThanOrEqual(progress[index - 1]!);
    }
  });

  it('reports a failed run with the exit code and the end of the error output', async () => {
    const outcome = await runFfmpeg({
      ffmpegPath,
      args: ['-hide_banner', '-loglevel', 'error', '-i', '/no/such/input.webm', '-f', 'null', '-'],
    });
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.stderrTail).toMatch(/No such file or directory/);
  });

  it('reports a binary that cannot be started as a failure instead of throwing', async () => {
    const outcome = await runFfmpeg({ ffmpegPath: '/no/such/ffmpeg', args: ['-version'] });
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.stderrTail).toMatch(/ENOENT/);
  });

  it('kills FFmpeg promptly when the signal aborts', async () => {
    const controller = new AbortController();
    const startedAt = performance.now();
    // Ten minutes of 720p would take far longer than this test allows.
    const running = runFfmpeg({
      ffmpegPath,
      args: nullEncodeArgs(600),
      signal: controller.signal,
      onOutputSeconds: () => controller.abort(),
    });
    expect(await running).toEqual({ status: 'cancelled' });
    expect(performance.now() - startedAt).toBeLessThan(5000);
  });

  it('does not start FFmpeg at all when the signal is already aborted', async () => {
    const outcome = await runFfmpeg({
      ffmpegPath: '/no/such/ffmpeg',
      args: [],
      signal: AbortSignal.abort(),
    });
    expect(outcome).toEqual({ status: 'cancelled' });
  });
});
