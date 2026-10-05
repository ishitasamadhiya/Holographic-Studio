import { describe, expect, it } from 'vitest';
import { safeMp4FileName, withMp4Extension } from './saveFileName';

describe('safeMp4FileName', () => {
  const fallback = 'Holographic-Studio-Take.mp4';

  it('keeps an ordinary name and guarantees the extension', () => {
    expect(safeMp4FileName('My Cover.mp4', fallback)).toBe('My Cover.mp4');
    expect(safeMp4FileName('My Cover', fallback)).toBe('My Cover.mp4');
    expect(safeMp4FileName('My Cover.MP4', fallback)).toBe('My Cover.mp4');
    expect(safeMp4FileName('Take 2 (final).v2', fallback)).toBe('Take 2 (final).v2.mp4');
  });

  it('strips folders and characters that are not allowed in file names', () => {
    expect(safeMp4FileName('../../etc/passwd', fallback)).toBe('passwd.mp4');
    expect(safeMp4FileName('C:\\Users\\x\\take.mp4', fallback)).toBe('take.mp4');
    expect(safeMp4FileName('what? a "take": <1>|*.mp4', fallback)).toBe('what a take 1.mp4');
    expect(safeMp4FileName('line\nbreak\t.mp4', fallback)).toBe('linebreak.mp4');
    expect(safeMp4FileName('  ..hidden.. ', fallback)).toBe('hidden.mp4');
  });

  it('falls back when nothing usable is left', () => {
    expect(safeMp4FileName('', fallback)).toBe(fallback);
    expect(safeMp4FileName('.mp4', fallback)).toBe(fallback);
    expect(safeMp4FileName('///', fallback)).toBe(fallback);
    expect(safeMp4FileName(undefined, fallback)).toBe(fallback);
    expect(safeMp4FileName(42, fallback)).toBe(fallback);
  });

  it('limits the length', () => {
    expect(safeMp4FileName('x'.repeat(1000), fallback).length).toBe(204);
  });
});

describe('withMp4Extension', () => {
  it('adds the extension only when it is missing', () => {
    expect(withMp4Extension('/out/take')).toBe('/out/take.mp4');
    expect(withMp4Extension('/out/take.mp4')).toBe('/out/take.mp4');
    expect(withMp4Extension('/out/take.MP4')).toBe('/out/take.MP4');
    expect(withMp4Extension('/out.mp4/take')).toBe('/out.mp4/take.mp4');
    expect(withMp4Extension('/out/take.mov')).toBe('/out/take.mov.mp4');
  });
});
