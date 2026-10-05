import { describe, expect, it } from 'vitest';
import { createExportProgress, type ExportStageProgress } from './exportProgress';

function recorder() {
  const events: ExportStageProgress[] = [];
  const report = createExportProgress((progress) => events.push(progress));
  return { events, report };
}

describe('createExportProgress', () => {
  it('places the stages one after another on a single 0..1 scale', () => {
    const { events, report } = recorder();
    report('mixing', 0);
    report('mixing', 0.5);
    report('mixing', 1);
    report('encoding', 0);
    report('encoding', 0.5);
    report('encoding', 1);
    report('finishing', 0);
    report('finishing', 1);

    expect(events.map((event) => event.stage)).toEqual([
      'mixing',
      'mixing',
      'mixing',
      'encoding',
      'encoding',
      'encoding',
      'finishing',
      'finishing',
    ]);
    const fractions = events.map((event) => event.fraction);
    expect(fractions[0]).toBe(0);
    expect(fractions[2]).toBeCloseTo(0.1);
    expect(fractions[4]).toBeCloseTo(0.54);
    expect(fractions[5]).toBeCloseTo(0.98);
    expect(fractions.at(-1)).toBe(1);
  });

  it('never goes backwards, even when encoding restarts with another encoder', () => {
    const { events, report } = recorder();
    report('encoding', 0.6);
    report('encoding', 0);
    report('encoding', 0.3);
    report('encoding', 0.7);
    report('mixing', 0.2);

    const fractions = events.map((event) => event.fraction);
    for (let index = 1; index < fractions.length; index++) {
      expect(fractions[index]!).toBeGreaterThanOrEqual(fractions[index - 1]!);
    }
    expect(Math.max(...fractions)).toBeCloseTo(0.1 + 0.88 * 0.7);
  });

  it('drops steps too small to see but always announces a new stage and completion', () => {
    const { events, report } = recorder();
    report('encoding', 0.5);
    for (let step = 1; step <= 100; step++) report('encoding', 0.5 + step * 0.00001);
    expect(events.length).toBe(1);

    report('finishing', 0);
    report('finishing', 1);
    report('finishing', 1);
    expect(events.map((event) => event.stage)).toEqual(['encoding', 'finishing', 'finishing']);
    expect(events.at(-1)).toEqual({ stage: 'finishing', fraction: 1 });
  });

  it('clamps out-of-range and non-finite stage fractions', () => {
    const { events, report } = recorder();
    report('mixing', -5);
    report('mixing', Number.NaN);
    report('mixing', 7);
    expect(events[0]).toEqual({ stage: 'mixing', fraction: 0 });
    expect(events.at(-1)?.fraction).toBeCloseTo(0.1);
  });

  it('works without a listener', () => {
    expect(() => createExportProgress(undefined)('mixing', 0.5)).not.toThrow();
  });
});
