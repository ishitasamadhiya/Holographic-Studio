import { spawn } from 'node:child_process';
import { createProgressParser } from './ffmpegProgress';

export type FfmpegOutcome =
  | { status: 'completed' }
  | { status: 'failed'; exitCode: number | null; stderrTail: string }
  | { status: 'cancelled' };

export interface RunFfmpegOptions {
  ffmpegPath: string;
  args: readonly string[];
  /** Aborting kills FFmpeg immediately. */
  signal?: AbortSignal;
  /** Seconds of output encoded so far (requires `-progress pipe:1` in the arguments). */
  onOutputSeconds?: (seconds: number) => void;
}

const STDERR_TAIL_CHARS = 4000;

/**
 * Runs FFmpeg to completion and reports how it ended; it never throws for a failed run.
 * The end of FFmpeg's error output is kept for diagnosis.
 */
export function runFfmpeg(options: RunFfmpegOptions): Promise<FfmpegOutcome> {
  const { ffmpegPath, args, signal, onOutputSeconds } = options;
  if (signal?.aborted) return Promise.resolve({ status: 'cancelled' });

  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrTail = '';
    let spawnError: Error | null = null;

    // SIGKILL: a cancelled export is deleted anyway, so there is nothing for FFmpeg to finish.
    const kill = (): void => void child.kill('SIGKILL');
    signal?.addEventListener('abort', kill, { once: true });

    const feedProgress = onOutputSeconds ? createProgressParser(onOutputSeconds) : null;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => feedProgress?.(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
    });

    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (exitCode) => {
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) resolve({ status: 'cancelled' });
      else if (exitCode === 0) resolve({ status: 'completed' });
      else {
        const detail = spawnError ? `${spawnError.message}\n${stderrTail}` : stderrTail;
        resolve({ status: 'failed', exitCode, stderrTail: detail.trim() });
      }
    });
  });
}
