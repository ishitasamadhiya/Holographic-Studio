import { describe, expect, it } from 'vitest';
import { MeterAccumulator } from './meterAccumulator';
import type { VocalMetersMessage } from './protocol';

function report(overrides: Partial<VocalMetersMessage>): VocalMetersMessage {
  return {
    type: 'meters',
    inputPeak: 0,
    outputPeak: 0,
    detectedMidi: Number.NaN,
    targetMidi: Number.NaN,
    correctionCents: 0,
    ...overrides,
  };
}

describe('MeterAccumulator', () => {
  it('reports silence and no pitch before any report', () => {
    expect(new MeterAccumulator().read()).toEqual({
      inputLevel: 0,
      outputLevel: 0,
      detectedMidi: null,
      targetMidi: null,
      correctionCents: 0,
    });
  });

  it('holds the highest peak since the last read, then starts over', () => {
    const meters = new MeterAccumulator();
    meters.add(report({ inputPeak: 0.2, outputPeak: 0.1 }));
    meters.add(report({ inputPeak: 0.7, outputPeak: 0.4 }));
    meters.add(report({ inputPeak: 0.3, outputPeak: 0.6 }));
    expect(meters.read()).toMatchObject({ inputLevel: 0.7, outputLevel: 0.6 });
    meters.add(report({ inputPeak: 0.1, outputPeak: 0.2 }));
    expect(meters.read()).toMatchObject({ inputLevel: 0.1, outputLevel: 0.2 });
  });

  it('repeats the latest report when read again before a new one arrives', () => {
    const meters = new MeterAccumulator();
    meters.add(report({ inputPeak: 0.7, outputPeak: 0.4 }));
    meters.add(report({ inputPeak: 0.3, outputPeak: 0.6 }));
    meters.read();
    expect(meters.read()).toMatchObject({ inputLevel: 0.3, outputLevel: 0.6 });
    meters.reset();
    expect(meters.read()).toMatchObject({ inputLevel: 0, outputLevel: 0 });
  });

  it('caps levels at 1', () => {
    const meters = new MeterAccumulator();
    meters.add(report({ inputPeak: 1.8, outputPeak: 1.2 }));
    expect(meters.read()).toMatchObject({ inputLevel: 1, outputLevel: 1 });
  });

  it('reports the latest pitch readings and keeps them between reads', () => {
    const meters = new MeterAccumulator();
    meters.add(report({ detectedMidi: 60.4, targetMidi: 60, correctionCents: -40 }));
    meters.add(report({ detectedMidi: 61.9, targetMidi: 62, correctionCents: 10 }));
    const expected = { detectedMidi: 61.9, targetMidi: 62, correctionCents: 10 };
    expect(meters.read()).toMatchObject(expected);
    expect(meters.read()).toMatchObject(expected);
  });

  it('turns an unvoiced (NaN) pitch into null', () => {
    const meters = new MeterAccumulator();
    meters.add(report({ detectedMidi: 60, targetMidi: 60 }));
    meters.add(report({}));
    expect(meters.read()).toMatchObject({ detectedMidi: null, targetMidi: null });
  });

  it('ignores non-finite levels', () => {
    const meters = new MeterAccumulator();
    meters.add(
      report({ inputPeak: Number.NaN, outputPeak: Infinity, correctionCents: Number.NaN }),
    );
    expect(meters.read()).toMatchObject({ inputLevel: 0, outputLevel: 0, correctionCents: 0 });
  });

  it('forgets everything on reset', () => {
    const meters = new MeterAccumulator();
    meters.add(report({ inputPeak: 0.5, detectedMidi: 60, targetMidi: 60, correctionCents: 5 }));
    meters.reset();
    expect(meters.read()).toEqual(new MeterAccumulator().read());
  });
});
