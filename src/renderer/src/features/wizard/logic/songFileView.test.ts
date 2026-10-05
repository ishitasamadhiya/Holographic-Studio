import { describe, expect, it } from 'vitest';
import { createAppError } from '@shared/errors';
import { createInitialStudioState } from '@renderer/state/staticStudio';
import type { BackingState, ReferenceState } from '@renderer/state/studioTypes';
import { analysisProgressText, backingFileView, referenceFileView } from './songFileView';

const song = { name: 'Midnight City.mp3', path: '/music/Midnight City.mp3', durationSec: 243 };

function backing(patch: Partial<BackingState>): BackingState {
  return { ...createInitialStudioState().backing, ...patch };
}

function reference(patch: Partial<ReferenceState>): ReferenceState {
  return { ...createInitialStudioState().reference, ...patch };
}

describe('backingFileView', () => {
  it('is an empty zone with its own hint before a file is chosen', () => {
    expect(backingFileView(backing({}))).toEqual({
      zoneState: 'empty',
      fileName: null,
      statusText: undefined,
      hasFile: false,
    });
  });

  it('shows the file while it is being opened', () => {
    expect(backingFileView(backing({ status: 'loading', file: song }))).toEqual({
      zoneState: 'loading',
      fileName: 'Midnight City.mp3',
      statusText: 'Opening…',
      hasFile: true,
    });
  });

  it('shows the name and length once ready', () => {
    const view = backingFileView(backing({ status: 'ready', file: song }));
    expect(view.zoneState).toBe('ready');
    expect(view.statusText).toBe('Backing track · 4:03');
    expect(view.hasFile).toBe(true);
  });

  it('leaves the length out when it is not known', () => {
    const view = backingFileView(backing({ status: 'ready', file: { ...song, durationSec: 0 } }));
    expect(view.statusText).toBe('Backing track');
  });

  it('shows the friendly error and asks for another file when loading failed', () => {
    const error = createAppError('unsupported-audio-file', 'codec 0x55');
    const view = backingFileView(backing({ status: 'failed', file: song, error }));
    expect(view.zoneState).toBe('error');
    expect(view.statusText).toBe('That file could not be opened. Try an MP3, WAV, or M4A file.');
    expect(view.statusText).not.toContain('codec');
    expect(view.hasFile).toBe(false);
  });

  it('still says something friendly when a failure carries no error', () => {
    const view = backingFileView(backing({ status: 'failed' }));
    expect(view.statusText).toBe('That file could not be read. It may have been moved or deleted.');
  });
});

describe('referenceFileView', () => {
  it('is an empty zone before a file is chosen', () => {
    expect(referenceFileView(reference({})).zoneState).toBe('empty');
  });

  it('shows analysis progress on the file while the melody is being learned', () => {
    const view = referenceFileView(reference({ status: 'analyzing', file: song, progress: 0.4 }));
    expect(view).toEqual({
      zoneState: 'loading',
      fileName: 'Midnight City.mp3',
      statusText: 'Analyzing reference vocal… 40%',
      hasFile: true,
    });
  });

  it('shows the name and length once ready', () => {
    const view = referenceFileView(reference({ status: 'ready', file: song }));
    expect(view.zoneState).toBe('ready');
    expect(view.statusText).toBe('Original song · 4:03');
  });

  it('shows the friendly error when the song could not be used', () => {
    const error = createAppError('analysis-failed');
    const view = referenceFileView(reference({ status: 'failed', file: song, error }));
    expect(view.zoneState).toBe('error');
    expect(view.statusText).toBe(error.message);
    expect(view.hasFile).toBe(false);
  });
});

describe('analysisProgressText', () => {
  it('rounds to whole percent and stays within 0–100', () => {
    expect(analysisProgressText(0.404)).toBe('Analyzing reference vocal… 40%');
    expect(analysisProgressText(-1)).toBe('Analyzing reference vocal… 0%');
    expect(analysisProgressText(7)).toBe('Analyzing reference vocal… 100%');
    expect(analysisProgressText(Number.NaN)).toBe('Analyzing reference vocal… 0%');
  });
});
