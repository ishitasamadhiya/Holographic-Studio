import { describe, expect, it } from 'vitest';
import { fail, ok, type Result } from '@shared/errors';
import type { ExportResult } from '@shared/take';
import { ExportJobs } from './exportJobs';

const DONE: Result<ExportResult> = ok({ outputPath: '/out.mp4', durationSec: 1, sizeBytes: 10 });

/** A job that finishes when released, or reports cancellation when its signal aborts. */
function controllableJob() {
  let release: () => void = () => undefined;
  const job = (signal: AbortSignal): Promise<Result<ExportResult>> =>
    new Promise((resolve) => {
      release = () => resolve(DONE);
      signal.addEventListener('abort', () => resolve(fail('export-cancelled')));
    });
  return { job, release: () => release() };
}

describe('ExportJobs', () => {
  it('returns the job result and forgets the job afterwards', async () => {
    const jobs = new ExportJobs();
    const { job, release } = controllableJob();
    const running = jobs.run('take-a', job);
    release();
    expect(await running).toBe(DONE);
    // Nothing is left running: the same take can be exported again.
    expect(await jobs.run('take-a', async () => DONE)).toBe(DONE);
  });

  it('refuses a second export of the same take while the first is running', async () => {
    const jobs = new ExportJobs();
    const first = controllableJob();
    const running = jobs.run('take-a', first.job);

    let secondStarted = false;
    const second = await jobs.run('take-a', async () => {
      secondStarted = true;
      return DONE;
    });
    expect(second).toMatchObject({ ok: false, error: { code: 'export-failed' } });
    expect(secondStarted).toBe(false);

    first.release();
    await running;
    expect(await jobs.run('take-a', async () => DONE)).toBe(DONE);
  });

  it('cancels only the export of the given take', async () => {
    const jobs = new ExportJobs();
    const a = controllableJob();
    const b = controllableJob();
    const runningA = jobs.run('take-a', a.job);
    const runningB = jobs.run('take-b', b.job);

    await jobs.cancel('take-a');
    await jobs.cancel('unknown-take');
    expect(await runningA).toMatchObject({ ok: false, error: { code: 'export-cancelled' } });
    // take-b is still running: a second export of it is refused.
    expect(await jobs.run('take-b', async () => DONE)).toMatchObject({
      ok: false,
      error: { code: 'export-failed' },
    });

    b.release();
    expect(await runningB).toBe(DONE);
  });

  it('cancelAll stops every running export', async () => {
    const jobs = new ExportJobs();
    const results = [
      jobs.run('take-a', controllableJob().job),
      jobs.run('take-b', controllableJob().job),
    ];
    await jobs.cancelAll();
    for (const result of await Promise.all(results)) {
      expect(result).toMatchObject({ ok: false, error: { code: 'export-cancelled' } });
    }
  });

  it('cancel() waits until the export has actually stopped', async () => {
    const jobs = new ExportJobs();
    let cleanedUp = false;
    const running = jobs.run(
      'take-a',
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            // Stopping takes a moment (FFmpeg exits, temporary files are removed).
            setTimeout(() => {
              cleanedUp = true;
              resolve(fail('export-cancelled'));
            }, 20);
          });
        }),
    );

    await jobs.cancel('take-a');
    expect(cleanedUp).toBe(true);
    await running;
  });

  it('knows whether anything is still running, up to the end of a cancelled job', async () => {
    const jobs = new ExportJobs();
    expect(jobs.hasRunning).toBe(false);

    let finishCleanup: () => void = () => undefined;
    const running = jobs.run(
      'take-a',
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            finishCleanup = () => resolve(fail('export-cancelled'));
          });
        }),
    );
    expect(jobs.hasRunning).toBe(true);

    const cancelled = jobs.cancelAll();
    // Cancelled but still cleaning up: quitting now would leave its files behind.
    expect(jobs.hasRunning).toBe(true);
    finishCleanup();
    await cancelled;
    await running;
    expect(jobs.hasRunning).toBe(false);
  });

  it('forgets a job that throws', async () => {
    const jobs = new ExportJobs();
    await expect(
      jobs.run('take-a', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await jobs.run('take-a', async () => DONE)).toBe(DONE);
  });
});
