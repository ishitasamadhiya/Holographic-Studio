// What a song drop zone shows for the backing track and for the original song.
import { FRIENDLY_ERROR_MESSAGES } from '@shared/errors';
import type { BackingState, ReferenceState } from '@renderer/state/studioTypes';
import type { FileDropZoneState } from '@renderer/ui';
import { formatDuration } from './formatDuration';

export interface SongFileView {
  zoneState: FileDropZoneState;
  fileName: string | null;
  /** The zone's second line; undefined leaves the zone's own hint in place. */
  statusText: string | undefined;
  /** Whether a file is in place or on its way, so the step can simply continue. */
  hasFile: boolean;
}

const EMPTY_VIEW: SongFileView = {
  zoneState: 'empty',
  fileName: null,
  statusText: undefined,
  hasFile: false,
};

function describeSong(kind: string, durationSec: number | undefined): string {
  const duration = formatDuration(durationSec ?? 0);
  return duration ? `${kind} · ${duration}` : kind;
}

export function backingFileView(backing: BackingState): SongFileView {
  const fileName = backing.file?.name ?? null;
  switch (backing.status) {
    case 'none':
      return EMPTY_VIEW;
    case 'loading':
      return { zoneState: 'loading', fileName, statusText: 'Opening…', hasFile: true };
    case 'ready':
      return {
        zoneState: 'ready',
        fileName,
        statusText: describeSong('Backing track', backing.file?.durationSec),
        hasFile: true,
      };
    case 'failed':
      return {
        zoneState: 'error',
        fileName,
        statusText: backing.error?.message ?? FRIENDLY_ERROR_MESSAGES['file-read-failed'],
        hasFile: false,
      };
  }
}

/** "Analyzing reference vocal… 40%" */
export function analysisProgressText(progress: number): string {
  const percent = Math.round(Math.min(1, Math.max(0, progress || 0)) * 100);
  return `Analyzing reference vocal… ${percent}%`;
}

export function referenceFileView(reference: ReferenceState): SongFileView {
  const fileName = reference.file?.name ?? null;
  switch (reference.status) {
    case 'none':
      return EMPTY_VIEW;
    case 'loading':
      return { zoneState: 'loading', fileName, statusText: 'Opening…', hasFile: true };
    case 'analyzing':
      return {
        zoneState: 'loading',
        fileName,
        statusText: analysisProgressText(reference.progress),
        hasFile: true,
      };
    case 'ready':
      return {
        zoneState: 'ready',
        fileName,
        statusText: describeSong('Original song', reference.file?.durationSec),
        hasFile: true,
      };
    case 'failed':
      return {
        zoneState: 'error',
        fileName,
        statusText: reference.error?.message ?? FRIENDLY_ERROR_MESSAGES['analysis-failed'],
        hasFile: false,
      };
  }
}
