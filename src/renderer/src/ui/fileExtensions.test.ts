import { describe, expect, it } from 'vitest';
import { describeExtensions, fileExtension, isAcceptedFileName } from './fileExtensions';

describe('fileExtension', () => {
  it('returns the lower-cased text after the last dot', () => {
    expect(fileExtension('song.mp3')).toBe('mp3');
    expect(fileExtension('My Song.final.WAV')).toBe('wav');
  });

  it('returns an empty string when there is no usable extension', () => {
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('trailing.')).toBe('');
    expect(fileExtension('.hidden')).toBe('');
  });
});

describe('isAcceptedFileName', () => {
  const audio = ['mp3', 'wav', 'm4a'];

  it('accepts listed extensions regardless of case', () => {
    expect(isAcceptedFileName('Backing Track.MP3', audio)).toBe(true);
    expect(isAcceptedFileName('take.m4a', audio)).toBe(true);
  });

  it('accepts extension lists written with a leading dot or in upper case', () => {
    expect(isAcceptedFileName('take.wav', ['.WAV'])).toBe(true);
  });

  it('rejects other extensions, missing extensions and look-alikes', () => {
    expect(isAcceptedFileName('video.mov', audio)).toBe(false);
    expect(isAcceptedFileName('mp3', audio)).toBe(false);
    expect(isAcceptedFileName('song.mp3.txt', audio)).toBe(false);
    expect(isAcceptedFileName('song.mp34', audio)).toBe(false);
  });
});

describe('describeExtensions', () => {
  it('writes a readable list', () => {
    expect(describeExtensions(['mp3', 'wav', 'm4a'])).toBe('MP3, WAV or M4A');
    expect(describeExtensions(['mp3', '.wav'])).toBe('MP3 or WAV');
    expect(describeExtensions(['flac'])).toBe('FLAC');
    expect(describeExtensions([])).toBe('');
  });
});
