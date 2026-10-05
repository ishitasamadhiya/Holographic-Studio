import type { ExportStage } from '@shared/take';

export interface ExportStageProgress {
  stage: ExportStage;
  /** Overall progress of the whole export, 0..1. */
  fraction: number;
}

/**
 * Where each stage sits on the overall progress bar. Mixing a take takes a few seconds,
 * encoding takes most of the time, and finishing is a rename.
 */
const STAGE_RANGES: Record<ExportStage, readonly [start: number, end: number]> = {
  mixing: [0, 0.1],
  encoding: [0.1, 0.98],
  finishing: [0.98, 1],
};

/** Smallest step worth telling the UI about (FFmpeg and the mixer report far more often). */
const MIN_STEP = 0.002;

/**
 * Maps per-stage progress onto one overall fraction that never goes backwards — not even
 * when encoding starts over with the fallback encoder — and drops updates too small to see.
 */
export function createExportProgress(
  onProgress: ((progress: ExportStageProgress) => void) | undefined,
): (stage: ExportStage, stageFraction: number) => void {
  let lastStage: ExportStage | null = null;
  let lastFraction = 0;

  return (stage, stageFraction) => {
    const [start, end] = STAGE_RANGES[stage];
    const clamped = Math.min(1, Math.max(0, Number.isFinite(stageFraction) ? stageFraction : 0));
    const fraction = Math.max(lastFraction, start + (end - start) * clamped);

    const isNewStage = stage !== lastStage;
    const isVisibleStep = fraction - lastFraction >= MIN_STEP;
    const isCompletion = fraction === 1 && lastFraction < 1;
    if (!isNewStage && !isVisibleStep && !isCompletion) return;

    lastStage = stage;
    lastFraction = fraction;
    onProgress?.({ stage, fraction });
  };
}
