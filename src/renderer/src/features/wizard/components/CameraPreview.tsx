import { type ReactNode, useEffect, useRef } from 'react';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { CameraOffIcon, cx, Spinner } from '@renderer/ui';
import { settle } from './settle';
import styles from './CameraPreview.module.css';

/** Starts the camera when a step that shows it is opened and the camera is not on yet. */
export function useCameraWhileShown(wanted: boolean): void {
  const actions = useStudioActions();
  const status = useStudioState((state) => state.camera.status);

  useEffect(() => {
    if (wanted && status === 'off') settle(actions.startCamera());
  }, [wanted, status, actions]);
}

export interface CameraPreviewProps {
  className?: string;
  /** Drawn on top of the picture, e.g. the "hand seen" confirmations. */
  children?: ReactNode;
}

/**
 * The live camera picture, mirrored so it behaves like a mirror. The app owns the stream:
 * this only hands it the <video> element and styles it.
 */
export function CameraPreview({ className, children }: CameraPreviewProps) {
  const actions = useStudioActions();
  const status = useStudioState((state) => state.camera.status);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    actions.attachPreview(videoRef.current);
    return () => actions.attachPreview(null);
  }, [actions]);

  return (
    <div
      className={cx(styles.preview, className)}
      data-status={status}
      data-testid="wizard-camera-preview"
    >
      <video
        ref={videoRef}
        className={styles.video}
        aria-label="Camera preview"
        autoPlay
        muted
        playsInline
      />
      {status === 'starting' && (
        <div className={styles.cover}>
          <Spinner label="Starting the camera" />
        </div>
      )}
      {(status === 'off' || status === 'error') && (
        <div className={styles.cover} aria-hidden="true">
          <CameraOffIcon size={28} />
        </div>
      )}
      {children}
    </div>
  );
}
