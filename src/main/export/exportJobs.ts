import { fail, type Result } from '@shared/errors';
import type { ExportResult } from '@shared/take';

interface RunningJob {
  controller: AbortController;
  settled: Promise<void>;
}

/**
 * Keeps track of the exports that are running so they can be cancelled by take id,
 * and makes sure a take is never exported twice at the same time (both runs would fight
 * over the same temporary files).
 */
export class ExportJobs {
  private readonly running = new Map<string, RunningJob>();

  /** True while at least one export has not finished stopping and cleaning up. */
  get hasRunning(): boolean {
    return this.running.size > 0;
  }

  /** Runs `job` for the take, handing it the signal that cancel() will abort. */
  async run(
    takeId: string,
    job: (signal: AbortSignal) => Promise<Result<ExportResult>>,
  ): Promise<Result<ExportResult>> {
    if (this.running.has(takeId)) {
      return fail('export-failed', 'This take is already being exported');
    }
    const controller = new AbortController();
    const result = job(controller.signal);
    this.running.set(takeId, {
      controller,
      settled: result.then(
        () => undefined,
        () => undefined,
      ),
    });
    try {
      return await result;
    } finally {
      this.running.delete(takeId);
    }
  }

  /**
   * Cancels the take's export if one is running. Resolves once that export has really
   * stopped and cleaned up, so the take's files are free to be deleted afterwards.
   */
  async cancel(takeId: string): Promise<void> {
    const job = this.running.get(takeId);
    if (!job) return;
    job.controller.abort();
    await job.settled;
  }

  async cancelAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((takeId) => this.cancel(takeId)));
  }
}
