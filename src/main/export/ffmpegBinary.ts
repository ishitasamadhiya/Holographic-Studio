/**
 * In a packaged app the app's files live inside an app.asar archive, but an executable
 * cannot be run from inside an archive. electron-builder therefore unpacks the FFmpeg binary
 * next to it, into app.asar.unpacked, while ffmpeg-static still reports the in-archive
 * path. This rewrites one to the other; development paths pass through unchanged.
 */
export function unpackedAsarPath(path: string): string {
  return path.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

/** Runnable path of the bundled FFmpeg, given what `require('ffmpeg-static')` returned. */
export function resolveFfmpegPath(ffmpegStaticPath: string | null | undefined): string | null {
  return ffmpegStaticPath ? unpackedAsarPath(ffmpegStaticPath) : null;
}
