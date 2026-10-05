import { type ReactNode, useState } from 'react';
import { FRIENDLY_ERROR_MESSAGES } from '@shared/errors';
import { SUPPORTED_AUDIO_EXTENSIONS } from '@shared/ipc';
import { FileDropZone } from '@renderer/ui';
import type { SongFileView } from '../logic/songFileView';
import styles from './SongDropZone.module.css';

export interface SongDropZoneProps {
  /** What this file is, e.g. "Backing track". */
  label: string;
  icon?: ReactNode;
  view: SongFileView;
  /** Open the native file dialog. */
  onChoose: () => void;
  /** Load the file at this absolute path (it was dropped onto the zone). */
  onLoadPath: (path: string) => void;
  onClear: () => void;
  'data-testid'?: string;
}

/** Where on disk a dropped file lives, or null when it has no path (or no bridge to ask). */
function pathOfDroppedFile(file: File): string | null {
  try {
    return window.holo.files.pathForDroppedFile(file) || null;
  } catch {
    return null;
  }
}

/** A song picker: click to browse, or drop a file. Shows the app's progress with the file. */
export function SongDropZone({
  label,
  icon,
  view,
  onChoose,
  onLoadPath,
  onClear,
  ...rest
}: SongDropZoneProps) {
  // A problem with the drop itself (wrong kind of file, or one that is not on disk). The
  // app never hears about these, so they are shown here until the next attempt.
  const [dropProblem, setDropProblem] = useState<string | null>(null);

  const handleDrop = (file: File) => {
    const path = pathOfDroppedFile(file);
    if (path === null) {
      setDropProblem(FRIENDLY_ERROR_MESSAGES['file-read-failed']);
      return;
    }
    setDropProblem(null);
    onLoadPath(path);
  };

  const handleReject = (fileName: string) => {
    setDropProblem(`“${fileName}” is not a song file. Try an MP3, WAV, or M4A file.`);
  };

  // With no file in place the zone itself carries the problem; otherwise the file stays
  // on show and the problem goes underneath.
  const showsProblemInZone = dropProblem !== null && !view.hasFile;

  return (
    <div className={styles.wrapper}>
      <FileDropZone
        {...rest}
        label={label}
        icon={icon}
        extensions={SUPPORTED_AUDIO_EXTENSIONS}
        state={showsProblemInZone ? 'error' : view.zoneState}
        fileName={showsProblemInZone ? null : view.fileName}
        statusText={showsProblemInZone ? dropProblem : view.statusText}
        onBrowse={() => {
          setDropProblem(null);
          onChoose();
        }}
        onFileDrop={handleDrop}
        onReject={handleReject}
        onClear={() => {
          setDropProblem(null);
          onClear();
        }}
      />
      {dropProblem !== null && !showsProblemInZone && (
        <p role="alert" className={styles.problem}>
          {dropProblem}
        </p>
      )}
    </div>
  );
}
