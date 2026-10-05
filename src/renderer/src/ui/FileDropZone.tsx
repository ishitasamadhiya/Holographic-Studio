import {
  type DragEvent,
  type HTMLAttributes,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';
import { describeExtensions, isAcceptedFileName } from './fileExtensions';
import { IconButton } from './IconButton';
import { CheckIcon, CloseIcon, MusicNoteIcon, WarningIcon } from './icons';
import { cx } from './internal/classNames';
import { Spinner } from './Spinner';
import styles from './FileDropZone.module.css';

export type FileDropZoneState = 'empty' | 'loading' | 'ready' | 'error';

export interface FileDropZoneProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'
> {
  /** What this file is, e.g. "Backing track". */
  label: string;
  /** Accepted extensions without dots, e.g. SUPPORTED_AUDIO_EXTENSIONS. */
  extensions: readonly string[];
  /** Called when the zone is clicked: open the native file dialog here. */
  onBrowse: () => void;
  /** Called with a dropped file whose extension is accepted. */
  onFileDrop: (file: File) => void;
  /** Called with the name of a dropped file whose extension is not accepted. */
  onReject?: (fileName: string) => void;
  /** Shows a remove button next to the chosen file. */
  onClear?: () => void;
  state?: FileDropZoneState;
  /** Name of the chosen file (states other than 'empty'). */
  fileName?: string | null;
  /** Second line: progress text while loading, a friendly message on error, a result when ready. */
  statusText?: string;
  /** Second line while empty. Defaults to "Drop a file or click to browse · MP3, WAV or M4A". */
  hint?: string;
  /** Icon shown while empty. */
  icon?: ReactNode;
  disabled?: boolean;
}

function stateIcon(state: FileDropZoneState, emptyIcon: ReactNode): ReactNode {
  switch (state) {
    case 'loading':
      return <Spinner size="md" label={null} />;
    case 'ready':
      return <CheckIcon strokeWidth={2.25} />;
    case 'error':
      return <WarningIcon />;
    case 'empty':
      return emptyIcon;
  }
}

/** Pick a song file by clicking (native dialog) or by dropping it onto the zone. */
export function FileDropZone({
  label,
  extensions,
  onBrowse,
  onFileDrop,
  onReject,
  onClear,
  state = 'empty',
  fileName,
  statusText,
  hint,
  icon = <MusicNoteIcon />,
  disabled = false,
  className,
  ...rest
}: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  // dragenter/dragleave also fire for child elements; counting them tells real exits apart.
  const dragDepth = useRef(0);
  const detailId = useId();

  const hasFile = state !== 'empty' && Boolean(fileName);
  const primaryText = hasFile ? fileName : label;
  const secondaryText =
    statusText ??
    (hasFile
      ? label
      : (hint ?? `Drop a file or click to browse · ${describeExtensions(extensions)}`));

  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

  const handleDragEnter = (event: DragEvent) => {
    if (disabled || !carriesFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (event: DragEvent) => {
    if (disabled || !carriesFiles(event)) return;
    // Required for the element to count as a drop target at all.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragOver(false);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragOver(false);
    if (disabled) return;
    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (isAcceptedFileName(file.name, extensions)) onFileDrop(file);
    else onReject?.(file.name);
  };

  return (
    <div
      {...rest}
      className={cx(styles.zone, className)}
      data-state={state}
      data-drag-over={isDragOver || undefined}
      data-disabled={disabled || undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        type="button"
        className={styles.surface}
        disabled={disabled}
        aria-label={hasFile ? `${label}: ${fileName}. Choose a different file` : `Choose ${label}`}
        aria-describedby={detailId}
        onClick={onBrowse}
      >
        <span className={styles.icon} aria-hidden="true">
          {stateIcon(state, icon)}
        </span>
        <span className={styles.text}>
          <span className={styles.primary}>{primaryText}</span>
          <span
            id={detailId}
            className={styles.secondary}
            role={state === 'error' ? 'alert' : undefined}
          >
            {isDragOver ? 'Drop to use this file' : secondaryText}
          </span>
        </span>
      </button>
      {hasFile && onClear && !disabled && (
        <IconButton
          label={`Remove ${label}`}
          variant="ghost"
          size="sm"
          className={styles.clear}
          onClick={onClear}
        >
          <CloseIcon />
        </IconButton>
      )}
    </div>
  );
}
