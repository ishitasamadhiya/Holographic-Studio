// What the two song chips in the top bar say for each state of the backing track and the
// reference song. Pure, so the wording can be tested without rendering anything.
import type { BackingState, ReferenceState } from '@renderer/state/studioTypes';

export type SongChipKind = 'add' | 'busy' | 'ready' | 'failed';

export interface SongChipView {
  kind: SongChipKind;
  text: string;
  /** A quiet second fact shown after the text (the song's key). */
  detail: string | null;
  /** 0..1 while `kind` is 'busy' and the amount of work is known. */
  progress: number | null;
  /** The full story for the tooltip and for screen readers. */
  description: string;
}

export function describeBackingChip(backing: BackingState): SongChipView {
  switch (backing.status) {
    case 'none':
      return {
        kind: 'add',
        text: 'Add backing track',
        detail: null,
        progress: null,
        description: 'Choose the instrumental you will sing over',
      };
    case 'loading':
      return {
        kind: 'busy',
        text: 'Loading backing track…',
        detail: null,
        progress: null,
        description: backing.file ? `Loading ${backing.file.name}` : 'Loading backing track',
      };
    case 'ready': {
      const name = backing.file?.name ?? 'Backing track';
      return {
        kind: 'ready',
        text: name,
        detail: null,
        progress: null,
        description: `Backing track: ${name}`,
      };
    }
    case 'failed':
      return {
        kind: 'failed',
        text: 'Backing track could not be opened',
        detail: null,
        progress: null,
        description: backing.error?.message ?? 'Choose a different file',
      };
  }
}

export function describeReferenceChip(reference: ReferenceState): SongChipView {
  switch (reference.status) {
    case 'none':
      return {
        kind: 'add',
        text: 'Add original song',
        detail: null,
        progress: null,
        description:
          'Optional: the original song teaches the autotune its melody. It is never recorded.',
      };
    case 'loading':
    case 'analyzing': {
      const progress = reference.status === 'analyzing' ? reference.progress : null;
      return {
        kind: 'busy',
        text: 'Analyzing reference vocal…',
        detail:
          progress === null ? null : `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`,
        progress,
        description: reference.file
          ? `Listening to ${reference.file.name}`
          : 'Listening to the original song',
      };
    }
    case 'ready': {
      const text = reference.melodyUsable ? 'Reference melody ready' : 'Following the song’s key';
      const source = reference.file ? ` from ${reference.file.name}` : '';
      const key = reference.keyLabel ? `Key: ${reference.keyLabel}` : 'Key unknown';
      return {
        kind: 'ready',
        text,
        detail: reference.keyLabel,
        progress: null,
        description: reference.melodyUsable
          ? `${key}. Autotune follows the melody${source}.`
          : `${key}. The melody was not clear enough, so autotune follows the key.`,
      };
    }
    case 'failed':
      return {
        kind: 'failed',
        text: 'Original song could not be analyzed',
        detail: null,
        progress: null,
        description: reference.error?.message ?? 'Choose a different file',
      };
  }
}
