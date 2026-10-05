import { describe, expect, it } from 'vitest';
import { resolveFfmpegPath, unpackedAsarPath } from './ffmpegBinary';

describe('unpackedAsarPath', () => {
  it('points a packaged macOS path at the unpacked copy', () => {
    expect(
      unpackedAsarPath(
        '/Applications/Holographic Studio.app/Contents/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg',
      ),
    ).toBe(
      '/Applications/Holographic Studio.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg',
    );
  });

  it('points a packaged Windows path at the unpacked copy', () => {
    expect(
      unpackedAsarPath(
        'C:\\Program Files\\Holographic Studio\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe',
      ),
    ).toBe(
      'C:\\Program Files\\Holographic Studio\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe',
    );
  });

  it('leaves development paths alone', () => {
    const devPath = '/Users/dev/Holographic-Studio/node_modules/ffmpeg-static/ffmpeg';
    expect(unpackedAsarPath(devPath)).toBe(devPath);
  });

  it('is safe to apply twice', () => {
    const unpacked = '/opt/app/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg';
    expect(unpackedAsarPath(unpacked)).toBe(unpacked);
    expect(unpackedAsarPath(unpackedAsarPath('/opt/app/resources/app.asar/bin/ffmpeg'))).toBe(
      '/opt/app/resources/app.asar.unpacked/bin/ffmpeg',
    );
  });

  it('does not touch names that merely contain "app.asar"', () => {
    expect(unpackedAsarPath('/data/my-app.asar-backup/ffmpeg')).toBe(
      '/data/my-app.asar-backup/ffmpeg',
    );
    expect(unpackedAsarPath('/data/notapp.asar/ffmpeg')).toBe('/data/notapp.asar/ffmpeg');
  });
});

describe('resolveFfmpegPath', () => {
  it('reports a missing binary (unsupported platform) as null', () => {
    expect(resolveFfmpegPath(null)).toBeNull();
    expect(resolveFfmpegPath(undefined)).toBeNull();
    expect(resolveFfmpegPath('')).toBeNull();
  });

  it('rewrites the path ffmpeg-static reports inside a packaged app', () => {
    expect(resolveFfmpegPath('/x/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg')).toBe(
      '/x/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg',
    );
  });
});
