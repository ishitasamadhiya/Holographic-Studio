import type { ReactNode } from 'react';
import { CheckIcon, cx, InfoIcon, Spinner } from '@renderer/ui';
import styles from './StatusNote.module.css';

export type StatusNoteTone = 'neutral' | 'busy' | 'success';

export interface StatusNoteProps {
  tone?: StatusNoteTone;
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}

function toneIcon(tone: StatusNoteTone): ReactNode {
  switch (tone) {
    case 'success':
      return <CheckIcon size={16} strokeWidth={2.25} />;
    case 'busy':
      return <Spinner size="sm" label={null} />;
    case 'neutral':
      return <InfoIcon size={16} />;
  }
}

/**
 * One quiet line that reports how the step is going ("Listening…", "We can hear you").
 * Changes are announced politely to screen readers.
 */
export function StatusNote({ tone = 'neutral', children, className, ...rest }: StatusNoteProps) {
  return (
    <p
      {...rest}
      role="status"
      aria-live="polite"
      className={cx(styles.note, className)}
      data-tone={tone}
    >
      <span className={styles.icon} aria-hidden="true">
        {toneIcon(tone)}
      </span>
      <span>{children}</span>
    </p>
  );
}
