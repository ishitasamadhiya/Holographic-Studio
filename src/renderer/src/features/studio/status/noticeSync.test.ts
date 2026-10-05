import { describe, expect, it } from 'vitest';
import type { Notice } from '@renderer/state/studioTypes';
import { EMPTY_NOTICE_MEMORY, planNoticeSync, type NoticeMemory } from './noticeSync';

function notice(id: string, kind: Notice['kind'] = 'info'): Notice {
  return { id, kind, message: `Message ${id}` };
}

function memory(shown: string[], reported: string[] = []): NoticeMemory {
  return { shown: new Set(shown), reported: new Set(reported) };
}

describe('planNoticeSync', () => {
  it('shows notices it has not seen and remembers them', () => {
    const plan = planNoticeSync([notice('a'), notice('b')], [], EMPTY_NOTICE_MEMORY);
    expect(plan.show.map((item) => item.id)).toEqual(['a', 'b']);
    expect(plan.hide).toEqual([]);
    expect(plan.dismiss).toEqual([]);
    expect([...plan.memory.shown]).toEqual(['a', 'b']);
  });

  it('does nothing while every notice has its toast', () => {
    const plan = planNoticeSync([notice('a')], ['a'], memory(['a']));
    expect(plan.show).toEqual([]);
    expect(plan.hide).toEqual([]);
    expect(plan.dismiss).toEqual([]);
  });

  it('reports a notice once when its toast has gone', () => {
    const first = planNoticeSync([notice('a'), notice('b')], ['b'], memory(['a', 'b']));
    expect(first.dismiss).toEqual(['a']);
    expect(first.show).toEqual([]);

    // The app has not removed the notice yet: it is neither shown nor reported again.
    const second = planNoticeSync([notice('a'), notice('b')], ['b'], first.memory);
    expect(second.dismiss).toEqual([]);
    expect(second.show).toEqual([]);
  });

  it('takes down the toast of a notice the app removed', () => {
    const plan = planNoticeSync([notice('b')], ['a', 'b'], memory(['a', 'b']));
    expect(plan.hide).toEqual(['a']);
    expect(plan.dismiss).toEqual([]);
    expect([...plan.memory.shown]).toEqual(['b']);
  });

  it('leaves toasts alone that did not come from a notice', () => {
    const plan = planNoticeSync([notice('a')], ['a', 'local-toast'], memory(['a']));
    expect(plan.hide).toEqual([]);
    expect(plan.dismiss).toEqual([]);
  });

  it('forgets removed notices so a reused id is shown again', () => {
    const removed = planNoticeSync([], [], memory(['a'], ['a']));
    expect(removed.memory.shown.size).toBe(0);
    expect(removed.memory.reported.size).toBe(0);

    const again = planNoticeSync([notice('a')], [], removed.memory);
    expect(again.show.map((item) => item.id)).toEqual(['a']);
  });
});
