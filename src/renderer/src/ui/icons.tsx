// One consistent icon set: 24 × 24 grid, 1.75 px round strokes, drawn in currentColor.
// Icons are decorative by default (aria-hidden); pass `title` when an icon stands alone.
import type { ReactNode, SVGAttributes } from 'react';

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, 'children'> {
  /** Width and height in CSS pixels. Defaults to 20. */
  size?: number;
  /** Accessible name. Without it the icon is hidden from assistive technology. */
  title?: string;
}

export type IconComponent = (props: IconProps) => ReactNode;

function createIcon(displayName: string, shapes: ReactNode): IconComponent {
  function Icon({ size = 20, title, strokeWidth = 1.75, ...rest }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        {...rest}
      >
        {shapes}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

const solid = { fill: 'currentColor', stroke: 'none' } as const;

export const MicrophoneIcon = createIcon(
  'MicrophoneIcon',
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11.25a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.75V21" />
    <path d="M9 21h6" />
  </>,
);

export const CameraIcon = createIcon(
  'CameraIcon',
  <>
    <rect x="2.75" y="6.5" width="12.5" height="11" rx="2.5" />
    <path d="M15.25 10.6l4.55-2.75a.8.8 0 0 1 1.2.7v6.9a.8.8 0 0 1-1.2.7l-4.55-2.75" />
  </>,
);

export const CameraOffIcon = createIcon(
  'CameraOffIcon',
  <>
    <path d="M9.5 6.5h3.25a2.5 2.5 0 0 1 2.5 2.5v2.75" />
    <path d="M5.1 6.55A2.5 2.5 0 0 0 2.75 9v6a2.5 2.5 0 0 0 2.5 2.5h7.5a2.5 2.5 0 0 0 2.4-1.8" />
    <path d="M15.25 10.6l4.55-2.75a.8.8 0 0 1 1.2.7v6.9a.8.8 0 0 1-1.2.7l-1.3-.8" />
    <path d="M3.5 3.5l17 17" />
  </>,
);

export const HeadphonesIcon = createIcon(
  'HeadphonesIcon',
  <>
    <path d="M4.25 15v-3a7.75 7.75 0 0 1 15.5 0v3" />
    <rect x="4.25" y="13.5" width="4" height="6.75" rx="1.75" />
    <rect x="15.75" y="13.5" width="4" height="6.75" rx="1.75" />
  </>,
);

export const SettingsIcon = createIcon(
  'SettingsIcon',
  <>
    <path d="M10.29 5.11l.39-2.42h2.64l.39 2.42a7.1 7.1 0 0 1 1.95.81l1.98-1.44 1.88 1.88-1.44 1.98a7.1 7.1 0 0 1 .81 1.95l2.42.39v2.64l-2.42.39a7.1 7.1 0 0 1-.81 1.95l1.44 1.98-1.88 1.88-1.98-1.44a7.1 7.1 0 0 1-1.95.81l-.39 2.42h-2.64l-.39-2.42a7.1 7.1 0 0 1-1.95-.81l-1.98 1.44-1.88-1.88 1.44-1.98a7.1 7.1 0 0 1-.81-1.95l-2.42-.39v-2.64l2.42-.39a7.1 7.1 0 0 1 .81-1.95L4.48 6.36l1.88-1.88 1.98 1.44a7.1 7.1 0 0 1 1.95-.81z" />
    <circle cx="12" cy="12" r="2.9" />
  </>,
);

export const MusicNoteIcon = createIcon(
  'MusicNoteIcon',
  <>
    <circle cx="6.5" cy="17.75" r="2.5" />
    <circle cx="16.5" cy="15.75" r="2.5" />
    <path d="M9 17.75V6.25l10-2.5v12" />
  </>,
);

export const WaveformIcon = createIcon(
  'WaveformIcon',
  <>
    <path d="M4 10.25v3.5" />
    <path d="M8 6.75v10.5" />
    <path d="M12 3.5v17" />
    <path d="M16 8v8" />
    <path d="M20 10.5v3" />
  </>,
);

export const HandIcon = createIcon(
  'HandIcon',
  <>
    <path d="M8.5 13.25V5.25a1.5 1.5 0 0 1 3 0v5.25" />
    <path d="M11.5 10.5V3.75a1.5 1.5 0 0 1 3 0v6.75" />
    <path d="M14.5 10.5V5.25a1.5 1.5 0 0 1 3 0V11" />
    <path d="M17.5 11V7.75a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.3a6 6 0 0 1-4.55-2.1l-3.8-4.45a1.55 1.55 0 0 1 2.3-2.08L8.5 14.75" />
  </>,
);

export const RecordIcon = createIcon(
  'RecordIcon',
  <>
    <circle cx="12" cy="12" r="8.25" />
    <circle cx="12" cy="12" r="3.75" {...solid} />
  </>,
);

export const PauseIcon = createIcon(
  'PauseIcon',
  <>
    <rect x="6.25" y="5" width="3.75" height="14" rx="1.25" />
    <rect x="14" y="5" width="3.75" height="14" rx="1.25" />
  </>,
);

export const PlayIcon = createIcon(
  'PlayIcon',
  <path d="M7.5 5.3v13.4a.75.75 0 0 0 1.15.63l10.6-6.7a.75.75 0 0 0 0-1.26L8.65 4.67a.75.75 0 0 0-1.15.63z" />,
);

export const StopIcon = createIcon(
  'StopIcon',
  <rect x="6" y="6" width="12" height="12" rx="2.75" />,
);

export const TrashIcon = createIcon(
  'TrashIcon',
  <>
    <path d="M4.5 6.5h15" />
    <path d="M9.5 6.5V4.75c0-.7.55-1.25 1.25-1.25h2.5c.7 0 1.25.55 1.25 1.25V6.5" />
    <path d="M6.5 6.5l.8 11.65a2 2 0 0 0 2 1.85h5.4a2 2 0 0 0 2-1.85l.8-11.65" />
    <path d="M10 10.5V16" />
    <path d="M14 10.5V16" />
  </>,
);

export const FolderIcon = createIcon(
  'FolderIcon',
  <path d="M3.5 7.5a2 2 0 0 1 2-2h3.55a2 2 0 0 1 1.5.68l.95 1.07a2 2 0 0 0 1.5.68h5.5a2 2 0 0 1 2 2v6.57a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
);

export const FileIcon = createIcon(
  'FileIcon',
  <>
    <path d="M13.5 3.5H8a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8z" />
    <path d="M13.5 3.5V6a2 2 0 0 0 2 2H18" />
  </>,
);

export const CheckIcon = createIcon('CheckIcon', <path d="M5 12.5l4.5 4.5L19 7.5" />);

export const WarningIcon = createIcon(
  'WarningIcon',
  <>
    <path d="M12 4.25c.43 0 .83.23 1.04.6l7.3 12.85a1.2 1.2 0 0 1-1.04 1.8H4.7a1.2 1.2 0 0 1-1.04-1.8l7.3-12.84c.21-.38.61-.61 1.04-.61z" />
    <path d="M12 9.75v4" />
    <circle cx="12" cy="16.6" r="0.95" {...solid} />
  </>,
);

export const InfoIcon = createIcon(
  'InfoIcon',
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11.25v5" />
    <circle cx="12" cy="8.1" r="0.95" {...solid} />
  </>,
);

export const CloseIcon = createIcon(
  'CloseIcon',
  <>
    <path d="M6.5 6.5l11 11" />
    <path d="M17.5 6.5l-11 11" />
  </>,
);

export const ChevronLeftIcon = createIcon('ChevronLeftIcon', <path d="M14.5 6l-6 6 6 6" />);
export const ChevronRightIcon = createIcon('ChevronRightIcon', <path d="M9.5 6l6 6-6 6" />);
export const ChevronUpIcon = createIcon('ChevronUpIcon', <path d="M6 14.5l6-6 6 6" />);
export const ChevronDownIcon = createIcon('ChevronDownIcon', <path d="M6 9.5l6 6 6-6" />);

export const SparklesIcon = createIcon(
  'SparklesIcon',
  <>
    <path d="M10 5.5c.5 4 2.5 6 7 7-4.5 1-6.5 3-7 7-.5-4-2.5-6-7-7 4.5-1 6.5-3 7-7z" />
    <path d="M18.25 2.75c.2 1.7 1.05 2.55 2.75 2.75-1.7.2-2.55 1.05-2.75 2.75-.2-1.7-1.05-2.55-2.75-2.75 1.7-.2 2.55-1.05 2.75-2.75z" />
  </>,
);

export const VolumeIcon = createIcon(
  'VolumeIcon',
  <>
    <path d="M3.75 9.75v4.5a1 1 0 0 0 1 1h2.6l4.3 3.5a.7.7 0 0 0 1.1-.55V5.8a.7.7 0 0 0-1.1-.55l-4.3 3.5h-2.6a1 1 0 0 0-1 1z" />
    <path d="M16.25 9.25a4 4 0 0 1 0 5.5" />
    <path d="M18.75 6.75a7.5 7.5 0 0 1 0 10.5" />
  </>,
);

export const RestartIcon = createIcon(
  'RestartIcon',
  <>
    <path d="M4 12a8 8 0 1 0 8-8 8.6 8.6 0 0 0-5.9 2.4L4 8.5" />
    <path d="M4 4v4.5h4.5" />
  </>,
);
