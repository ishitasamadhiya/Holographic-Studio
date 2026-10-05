import { useEffect, useRef, useState } from 'react';
import { resolveDroppedAudio } from './droppedAudio';

export interface BackingFileDropOptions {
  /** False while a file must not be swapped (a take is in progress, a dialog is open). */
  enabled: boolean;
  onAccept: (path: string) => void;
  onReject: (message: string) => void;
}

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') === true;
}

/**
 * Lets an audio file be dropped anywhere on the window to use it as the backing track.
 * Returns true while a file is being dragged over the window.
 */
export function useBackingFileDrop(options: BackingFileDropOptions): boolean {
  const [isDragging, setIsDragging] = useState(false);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    // dragenter/dragleave also fire for every child element; counting tells real exits apart.
    let depth = 0;

    const handleDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth += 1;
      if (latest.current.enabled) setIsDragging(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // Always claimed: left alone, Chromium would navigate the window to the dropped file.
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = latest.current.enabled ? 'copy' : 'none';
      }
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragging(false);
    };

    const handleDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setIsDragging(false);
      if (!latest.current.enabled) return;

      const dropped = resolveDroppedAudio(Array.from(event.dataTransfer?.files ?? []), (file) =>
        window.holo.files.pathForDroppedFile(file),
      );
      if (dropped.kind === 'accepted') latest.current.onAccept(dropped.path);
      else if (dropped.kind === 'rejected') latest.current.onReject(dropped.message);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  return isDragging && options.enabled;
}
