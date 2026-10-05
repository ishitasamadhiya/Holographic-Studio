import { describe, expect, it } from 'vitest';
import { exportStageLabel, fileNameFromPath } from './exportText';

describe('exportStageLabel', () => {
  it('names every stage in plain words', () => {
    expect(exportStageLabel('mixing')).toBe('Mixing your take');
    expect(exportStageLabel('encoding')).toBe('Creating the video');
    expect(exportStageLabel('finishing')).toBe('Finishing up');
  });

  it('has a label before the first progress report', () => {
    expect(exportStageLabel(null)).toBe('Getting ready');
  });
});

describe('fileNameFromPath', () => {
  it('returns the last part of a macOS or Windows path', () => {
    expect(fileNameFromPath('/Users/me/Movies/Take 1.mp4')).toBe('Take 1.mp4');
    expect(fileNameFromPath('C:\\Users\\me\\Videos\\Take 1.mp4')).toBe('Take 1.mp4');
  });

  it('copes with a bare name and a trailing separator', () => {
    expect(fileNameFromPath('Take.mp4')).toBe('Take.mp4');
    expect(fileNameFromPath('/Users/me/Movies/')).toBe('Movies');
    expect(fileNameFromPath('')).toBe('');
  });
});
