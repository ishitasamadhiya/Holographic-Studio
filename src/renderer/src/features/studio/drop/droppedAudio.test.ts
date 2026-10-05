import { describe, expect, it } from 'vitest';
import { resolveDroppedAudio } from './droppedAudio';

const pathFor = (file: { name: string }) => `/music/${file.name}`;

describe('resolveDroppedAudio', () => {
  it('ignores a drop without files', () => {
    expect(resolveDroppedAudio([], pathFor)).toEqual({ kind: 'none' });
  });

  it('accepts an audio file whatever the case of its extension', () => {
    expect(resolveDroppedAudio([{ name: 'Song.MP3' }], pathFor)).toEqual({
      kind: 'accepted',
      path: '/music/Song.MP3',
      name: 'Song.MP3',
    });
  });

  it('picks the first audio file out of several', () => {
    const dropped = [{ name: 'cover.png' }, { name: 'take.wav' }, { name: 'other.m4a' }];
    expect(resolveDroppedAudio(dropped, pathFor)).toMatchObject({
      kind: 'accepted',
      name: 'take.wav',
    });
  });

  it('explains why a non-audio file is refused', () => {
    expect(resolveDroppedAudio([{ name: 'notes.txt' }], pathFor)).toEqual({
      kind: 'rejected',
      message: '“notes.txt” is not an audio file. Try an MP3, WAV, or M4A file.',
    });
  });

  it('refuses a file that has no path on disk', () => {
    expect(resolveDroppedAudio([{ name: 'song.mp3' }], () => '')).toEqual({
      kind: 'rejected',
      message: '“song.mp3” could not be read. Use “Add backing track” instead.',
    });
  });

  it('refuses a file whose path lookup throws', () => {
    const failing = () => {
      throw new Error('not a real file');
    };
    expect(resolveDroppedAudio([{ name: 'song.mp3' }], failing).kind).toBe('rejected');
  });
});
