import type { HTMLAttributes, ReactNode } from 'react';
import { IconButton } from './IconButton';
import { CloseIcon } from './icons';
import { cx } from './internal/classNames';
import { type MessageTone, toneIcon } from './internal/tone';
import styles from './Banner.module.css';

export type BannerTone = MessageTone;

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: BannerTone;
  /** Replaces the tone's default icon (e.g. headphones for the feedback warning). */
  icon?: ReactNode;
  /** Optional bold lead-in. */
  title?: string;
  /** The message. */
  children: ReactNode;
  /** Optional trailing control, usually a small Button. */
  action?: ReactNode;
  /** Shows a dismiss button when provided. */
  onDismiss?: () => void;
}

/** An inline, persistent notice such as "Use headphones to prevent feedback". */
export function Banner({
  tone = 'info',
  icon,
  title,
  children,
  action,
  onDismiss,
  className,
  ...rest
}: BannerProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'note'}
      {...rest}
      className={cx(styles.banner, className)}
      data-tone={tone}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon ?? toneIcon(tone)}
      </span>
      <p className={styles.message}>
        {title && <strong className={styles.title}>{title} </strong>}
        {children}
      </p>
      {action && <div className={styles.action}>{action}</div>}
      {onDismiss && (
        <IconButton label="Dismiss" variant="ghost" size="sm" onClick={onDismiss}>
          <CloseIcon />
        </IconButton>
      )}
    </div>
  );
}
