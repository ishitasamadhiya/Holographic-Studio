// What the camera is asked for, and in which order when it cannot deliver.
import { VIDEO_RESOLUTIONS, type VideoResolution } from '@shared/settings';

export const CAMERA_FRAME_RATE = 30;

/** Sizes to try for a requested resolution, best first. */
const RESOLUTION_LADDER: Record<VideoResolution, readonly VideoResolution[]> = {
  '1080p': ['1080p', '720p'],
  '720p': ['720p'],
};

/**
 * The getUserMedia video constraints to try, in order: the requested size, then every
 * smaller standard size, then whatever the camera offers. Sizes are exact so that a camera
 * that cannot do one is refused (and the next is tried) instead of silently delivering some
 * odd nearby mode; the frame rate is only a preference, so a slower camera still opens.
 *
 * @param deviceId null = the system default camera
 */
export function cameraConstraintLadder(
  deviceId: string | null,
  resolution: VideoResolution,
): MediaTrackConstraints[] {
  const base: MediaTrackConstraints = { frameRate: { ideal: CAMERA_FRAME_RATE } };
  if (deviceId !== null) base.deviceId = { exact: deviceId };

  const sized = RESOLUTION_LADDER[resolution].map((step): MediaTrackConstraints => {
    const { width, height } = VIDEO_RESOLUTIONS[step];
    return { ...base, width: { exact: width }, height: { exact: height } };
  });
  return [...sized, base];
}
