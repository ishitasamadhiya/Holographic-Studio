import type { EngineMeters } from './engineTypes';
import type { VocalMetersMessage } from './protocol';

/**
 * Collects the meter reports the vocal-chain worklet posts ~30 times per second, so that a
 * reader polling at any rate sees the highest peak since its previous read.
 *
 * The UI reads about twice as often as reports arrive. A read that falls between two reports
 * repeats the latest report instead of dropping to zero, which would make meters flicker.
 */
export class MeterAccumulator {
  private inputPeak = 0;
  private outputPeak = 0;
  private latestInputPeak = 0;
  private latestOutputPeak = 0;
  private detectedMidi: number | null = null;
  private targetMidi: number | null = null;
  private correctionCents = 0;

  add(report: VocalMetersMessage): void {
    this.inputPeak = Math.max(this.inputPeak, finiteOr(report.inputPeak, 0));
    this.outputPeak = Math.max(this.outputPeak, finiteOr(report.outputPeak, 0));
    this.latestInputPeak = finiteOr(report.inputPeak, 0);
    this.latestOutputPeak = finiteOr(report.outputPeak, 0);
    this.detectedMidi = Number.isFinite(report.detectedMidi) ? report.detectedMidi : null;
    this.targetMidi = Number.isFinite(report.targetMidi) ? report.targetMidi : null;
    this.correctionCents = finiteOr(report.correctionCents, 0);
  }

  /** Returns the current readings and restarts the peak measurement. */
  read(): EngineMeters {
    const meters: EngineMeters = {
      inputLevel: Math.min(1, Math.max(this.inputPeak, this.latestInputPeak)),
      outputLevel: Math.min(1, Math.max(this.outputPeak, this.latestOutputPeak)),
      detectedMidi: this.detectedMidi,
      targetMidi: this.targetMidi,
      correctionCents: this.correctionCents,
    };
    this.inputPeak = 0;
    this.outputPeak = 0;
    return meters;
  }

  reset(): void {
    this.inputPeak = 0;
    this.outputPeak = 0;
    this.latestInputPeak = 0;
    this.latestOutputPeak = 0;
    this.detectedMidi = null;
    this.targetMidi = null;
    this.correctionCents = 0;
  }
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
