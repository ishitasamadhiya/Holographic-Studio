// Wording for the export dialogs.
import type { ExportStage } from '@shared/take';

const STAGE_LABELS: Record<ExportStage, string> = {
  mixing: 'Mixing your take',
  encoding: 'Creating the video',
  finishing: 'Finishing up',
};

/** A plain description of what the exporter is doing. null = it has not reported yet. */
export function exportStageLabel(stage: ExportStage | null): string {
  return stage === null ? 'Getting ready' : STAGE_LABELS[stage];
}

/** The last part of a path, whichever separator the platform uses. */
export function fileNameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const lastSeparator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return trimmed.slice(lastSeparator + 1);
}
