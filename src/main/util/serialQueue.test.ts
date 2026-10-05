import { describe, expect, it } from 'vitest';
import { SerialQueue } from './serialQueue';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('SerialQueue', () => {
  it('runs tasks one at a time in the order they were added', async () => {
    const queue = new SerialQueue();
    const events: string[] = [];
    const task = (name: string, ms: number) => async (): Promise<string> => {
      events.push(`start ${name}`);
      await sleep(ms);
      events.push(`end ${name}`);
      return name;
    };

    const results = await Promise.all([
      queue.run(task('slow', 30)),
      queue.run(task('fast', 1)),
      queue.run(task('medium', 10)),
    ]);

    expect(results).toEqual(['slow', 'fast', 'medium']);
    expect(events).toEqual([
      'start slow',
      'end slow',
      'start fast',
      'end fast',
      'start medium',
      'end medium',
    ]);
  });

  it('keeps going after a task fails, and reports the failure to its caller only', async () => {
    const queue = new SerialQueue();
    const failing = queue.run(async () => {
      throw new Error('disk full');
    });
    const following = queue.run(async () => 'still ran');

    await expect(failing).rejects.toThrow('disk full');
    await expect(following).resolves.toBe('still ran');
  });

  it('idle() waits for everything queued so far, even after a failure', async () => {
    const queue = new SerialQueue();
    let finished = 0;
    void queue.run(async () => {
      await sleep(10);
      finished += 1;
    });
    queue
      .run(async () => {
        throw new Error('ignored');
      })
      .catch(() => undefined);
    void queue.run(async () => {
      await sleep(5);
      finished += 1;
    });

    await queue.idle();
    expect(finished).toBe(2);
  });
});
