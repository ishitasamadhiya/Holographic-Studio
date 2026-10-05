import { useEffect, useRef } from 'react';
import { drawLandmarks } from '@renderer/tracking/drawLandmarks';
import { useLiveFrame, useStudioActions, useStudioState } from '@renderer/state/studioContext';
import styles from './CameraPreview.module.css';

/** Canvas size used until the camera has reported its real capture size. */
const FALLBACK_CAPTURE_SIZE = { width: 1280, height: 720 };

/**
 * The hand skeletons, for checking what the tracker sees. The canvas has the camera's own
 * pixel size and the same CSS as the video (cover + mirror), so a landmark lands exactly on
 * the hand it belongs to however the window crops the picture.
 */
function LandmarksOverlay() {
  const width = useStudioState((state) => state.camera.width) || FALLBACK_CAPTURE_SIZE.width;
  const height = useStudioState((state) => state.camera.height) || FALLBACK_CAPTURE_SIZE.height;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLiveFrame((live) => {
    const context = canvasRef.current?.getContext('2d');
    // The canvas is mirrored by CSS together with the video, so the drawing itself is not.
    if (context) drawLandmarks(context, live.gesture, { mirrored: false });
  });

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={styles.media}
      aria-hidden="true"
      data-testid="landmarks-overlay"
    />
  );
}

/**
 * The mirrored camera picture that fills the window. The app owns the stream: this component
 * only hands over the <video> element and styles it.
 */
export function CameraPreview() {
  const actions = useStudioActions();
  const showLandmarks = useStudioState((state) => state.settings.developer.showLandmarks);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    actions.attachPreview(videoRef.current);
    return () => actions.attachPreview(null);
  }, [actions]);

  return (
    <div className={styles.preview}>
      <video
        ref={videoRef}
        className={styles.media}
        autoPlay
        muted
        playsInline
        disablePictureInPicture
        aria-label="Camera preview"
        data-testid="camera-preview"
      />
      {showLandmarks && <LandmarksOverlay />}
      {/* Soft shading at the top and bottom, where the floating controls sit. */}
      <div className={styles.shade} aria-hidden="true" />
    </div>
  );
}
