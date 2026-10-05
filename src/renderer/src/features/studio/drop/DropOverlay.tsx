import { MusicNoteIcon } from '@renderer/ui';
import styles from './DropOverlay.module.css';

/** Shown while an audio file is dragged over the window. */
export function DropOverlay() {
  return (
    <div className={`${styles.overlay} app-no-drag`} data-testid="drop-overlay">
      <div className={styles.target}>
        <MusicNoteIcon size={28} />
        <p className={styles.title}>Drop to use as the backing track</p>
        <p className={styles.hint}>MP3, WAV or M4A</p>
      </div>
    </div>
  );
}
