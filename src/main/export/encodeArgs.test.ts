import { describe, expect, it } from 'vitest';
import { buildStillExportArgs, buildVideoExportArgs } from './encodeArgs';
import { HARDWARE_H264, SOFTWARE_H264 } from './videoEncoders';

/** Value following a flag, e.g. valueOf(args, '-t'). */
function valueOf(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe('buildVideoExportArgs', () => {
  const base = {
    videoPath: '/takes/abc/video.webm',
    audioPath: '/takes/abc/mix.wav',
    outputPath: '/Users/singer/Movies/My Take.partial.mp4',
    durationSec: 12.3456789,
    bitrateKbps: 12_000,
  };

  it('takes the picture from the recording and the sound from the mix', () => {
    const args = buildVideoExportArgs({ ...base, encoder: SOFTWARE_H264 });
    const inputs = args.flatMap((arg, index) => (arg === '-i' ? [args[index + 1]] : []));
    expect(inputs).toEqual([base.videoPath, base.audioPath]);
    const maps = args.flatMap((arg, index) => (arg === '-map' ? [args[index + 1]] : []));
    expect(maps).toEqual(['0:v:0', '1:a:0']);
    expect(args.at(-1)).toBe(base.outputPath);
  });

  it('zeroes the timestamps before forcing a constant 30 fps, then pads, then converts', () => {
    const filters = valueOf(buildVideoExportArgs({ ...base, encoder: SOFTWARE_H264 }), '-vf');
    expect(filters?.split(',').map((filter) => filter.split('=')[0])).toEqual([
      'setpts',
      'fps',
      'tpad',
      'scale',
      'format',
    ]);
    expect(filters).toContain('setpts=PTS-STARTPTS');
    expect(filters).toContain('fps=30');
    expect(filters).toContain('format=yuv420p');
  });

  it('cuts the output at exactly the take duration and writes a faststart MP4 with AAC', () => {
    const args = buildVideoExportArgs({ ...base, encoder: SOFTWARE_H264 });
    expect(valueOf(args, '-t')).toBe('12.345679');
    expect(valueOf(args, '-movflags')).toBe('+faststart');
    expect(valueOf(args, '-f')).toBe('mp4');
    expect(valueOf(args, '-c:a')).toBe('aac');
    expect(valueOf(args, '-b:a')).toBe('256k');
    expect(valueOf(args, '-ar')).toBe('48000');
    expect(valueOf(args, '-ac')).toBe('2');
    expect(valueOf(args, '-progress')).toBe('pipe:1');
  });

  it('configures the hardware encoder by bitrate and the software encoder by quality', () => {
    const hardware = buildVideoExportArgs({ ...base, encoder: HARDWARE_H264 });
    expect(valueOf(hardware, '-c:v')).toBe('h264_videotoolbox');
    expect(valueOf(hardware, '-b:v')).toBe('12000k');

    const software = buildVideoExportArgs({ ...base, encoder: SOFTWARE_H264 });
    expect(valueOf(software, '-c:v')).toBe('libx264');
    expect(valueOf(software, '-preset')).toBe('veryfast');
    expect(valueOf(software, '-crf')).toBe('18');
    expect(valueOf(software, '-bf')).toBe('0');
    expect(software).not.toContain('-b:v');
  });
});

describe('buildStillExportArgs', () => {
  const base = {
    audioPath: '/takes/abc/mix.wav',
    outputPath: '/out/take.partial.mp4',
    durationSec: 200,
  };

  it('uses the artwork file when there is one', () => {
    const args = buildStillExportArgs({ ...base, artworkPath: '/takes/abc/artwork.png' });
    const inputs = args.flatMap((arg, index) => (arg === '-i' ? [args[index + 1]] : []));
    expect(inputs).toEqual(['/takes/abc/artwork.png', base.audioPath]);
    expect(args).not.toContain('lavfi');
    // A literal path, never an image-sequence pattern.
    const artworkInput = args.indexOf('-i');
    expect(args.slice(artworkInput - 4, artworkInput)).toEqual([
      '-f',
      'image2',
      '-pattern_type',
      'none',
    ]);
  });

  it('generates a dark 1920x1080 frame when there is none', () => {
    const args = buildStillExportArgs({ ...base, artworkPath: null });
    const inputs = args.flatMap((arg, index) => (arg === '-i' ? [args[index + 1]] : []));
    expect(inputs[0]).toMatch(/^color=c=0x08080b:s=1920x1080/);
    expect(inputs[1]).toBe(base.audioPath);
    expect(valueOf(args, '-f')).toBe('lavfi');
  });

  it('fits the picture into 1920x1080 and lasts exactly as long as the audio', () => {
    const args = buildStillExportArgs({ ...base, artworkPath: null });
    const filters = valueOf(args, '-vf') ?? '';
    expect(filters).toContain('scale=1920:1080:force_original_aspect_ratio=decrease');
    expect(filters).toContain('pad=1920:1080');
    expect(filters).toContain('format=yuv420p');
    expect(valueOf(args, '-t')).toBe('200.000000');
    expect(valueOf(args, '-c:v')).toBe('libx264');
    expect(valueOf(args, '-c:a')).toBe('aac');
    expect(valueOf(args, '-movflags')).toBe('+faststart');
    expect(args.at(-1)).toBe(base.outputPath);
  });
});
