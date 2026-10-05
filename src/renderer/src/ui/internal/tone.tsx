import type { ReactNode } from 'react';
import { CheckIcon, InfoIcon, WarningIcon } from '../icons';

/** Message tones shared by toasts and banners. */
export type MessageTone = 'info' | 'success' | 'warning' | 'error';

export function toneIcon(tone: MessageTone): ReactNode {
  switch (tone) {
    case 'success':
      return <CheckIcon strokeWidth={2.25} />;
    case 'warning':
    case 'error':
      return <WarningIcon />;
    case 'info':
      return <InfoIcon />;
  }
}
