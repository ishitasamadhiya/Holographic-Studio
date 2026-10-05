import { describe, expect, it } from 'vitest';
import { createAppError } from '@shared/errors';
import type { BackingState, ReferenceState } from '@renderer/state/studioTypes';
import { describeBackingChip, describeReferenceChip } from './songLabels';

const file = { name: 'Midnight City.mp3', path: '/songs/Midnight City.mp3', durationSec: 240 };

function backing(overrides: Partial<BackingState>): BackingState {
  return { status: 'none', file: null, error: null, ...overrides };
}

function reference(overrides: Partial<ReferenceState>): ReferenceState {
  return {
    status: 'none',
    file: null,
    progress: 0,
    keyLabel: null,
    melodyUsable: false,
    error: null,
    ...overrides,
  };
}

describe('describeBackingChip', () => {
  it('invites adding a track when there is none', () => {
    expect(describeBackingChip(backing({}))).toMatchObject({
      kind: 'add',
      text: 'Add backing track',
    });
  });

  it('shows the file name once loaded', () => {
    const view = describeBackingChip(backing({ status: 'ready', file }));
    expect(view.kind).toBe('ready');
    expect(view.text).toBe('Midnight City.mp3');
    expect(view.description).toBe('Backing track: Midnight City.mp3');
  });

  it('is busy while loading', () => {
    const view = describeBackingChip(backing({ status: 'loading', file }));
    expect(view.kind).toBe('busy');
    expect(view.progress).toBeNull();
    expect(view.description).toBe('Loading Midnight City.mp3');
  });

  it('carries the friendly error when loading failed', () => {
    const error = createAppError('unsupported-audio-file');
    const view = describeBackingChip(backing({ status: 'failed', error }));
    expect(view.kind).toBe('failed');
    expect(view.description).toBe(error.message);
  });
});

describe('describeReferenceChip', () => {
  it('invites adding the original song when there is none', () => {
    expect(describeReferenceChip(reference({}))).toMatchObject({
      kind: 'add',
      text: 'Add original song',
    });
  });

  it('shows analysis progress as a whole percentage', () => {
    const view = describeReferenceChip(reference({ status: 'analyzing', file, progress: 0.416 }));
    expect(view.kind).toBe('busy');
    expect(view.text).toBe('Analyzing reference vocal…');
    expect(view.detail).toBe('42%');
    expect(view.progress).toBe(0.416);
  });

  it('has no percentage while the file is still being read', () => {
    const view = describeReferenceChip(reference({ status: 'loading', file }));
    expect(view.kind).toBe('busy');
    expect(view.text).toBe('Analyzing reference vocal…');
    expect(view.detail).toBeNull();
    expect(view.progress).toBeNull();
  });

  it('keeps an out-of-range progress within 0–100%', () => {
    expect(describeReferenceChip(reference({ status: 'analyzing', progress: 1.4 })).detail).toBe(
      '100%',
    );
    expect(describeReferenceChip(reference({ status: 'analyzing', progress: -1 })).detail).toBe(
      '0%',
    );
  });

  it('announces a usable melody with the key as a detail', () => {
    const view = describeReferenceChip(
      reference({ status: 'ready', file, keyLabel: 'A minor', melodyUsable: true }),
    );
    expect(view.kind).toBe('ready');
    expect(view.text).toBe('Reference melody ready');
    expect(view.detail).toBe('A minor');
    expect(view.description).toBe(
      'Key: A minor. Autotune follows the melody from Midnight City.mp3.',
    );
  });

  it('says it follows the key when the melody is not usable', () => {
    const view = describeReferenceChip(
      reference({ status: 'ready', file, keyLabel: 'A minor', melodyUsable: false }),
    );
    expect(view.text).toBe('Following the song’s key');
    expect(view.detail).toBe('A minor');
    expect(view.description).toContain('autotune follows the key');
  });

  it('carries the friendly error when analysis failed', () => {
    const error = createAppError('analysis-failed');
    const view = describeReferenceChip(reference({ status: 'failed', error }));
    expect(view.kind).toBe('failed');
    expect(view.description).toBe(error.message);
  });
});
