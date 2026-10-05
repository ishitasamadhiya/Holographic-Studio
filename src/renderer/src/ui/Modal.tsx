import { type HTMLAttributes, type ReactNode, useId, useRef } from 'react';
import { cx } from './internal/classNames';
import { Portal } from './internal/Portal';
import { useModalLayer } from './internal/useModalLayer';
import { usePresence } from './internal/usePresence';
import styles from './Modal.module.css';

export type ModalSize = 'sm' | 'md';

export interface ModalProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'role'> {
  open: boolean;
  /** Called for Escape and a click outside the dialog (unless `dismissible` is false). */
  onClose: () => void;
  title: string;
  /** The message under the title. */
  description?: ReactNode;
  /** Large icon above the title. */
  icon?: ReactNode;
  /** Extra content between the message and the actions (e.g. a file path or a progress bar). */
  children?: ReactNode;
  /** The buttons. Put `data-autofocus` on the one that should receive focus. */
  actions?: ReactNode;
  /** False forces an explicit choice: Escape and outside clicks do nothing. */
  dismissible?: boolean;
  /** `alertdialog` for confirmations that interrupt (e.g. discarding a take). */
  role?: 'dialog' | 'alertdialog';
  size?: ModalSize;
}

/** A centred dialog for short, focused moments: save succeeded, discard this take? */
export function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  actions,
  dismissible = true,
  role = 'dialog',
  size = 'sm',
  className,
  ...rest
}: ModalProps) {
  const { rendered, exiting } = usePresence(open);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useModalLayer({
    containerRef: dialogRef,
    active: rendered && !exiting,
    onEscape: dismissible ? onClose : undefined,
  });

  if (!rendered) return null;

  return (
    <Portal>
      <div className={cx(styles.layer, exiting && styles.exiting)}>
        <div className={styles.scrim} onClick={dismissible ? onClose : undefined} />
        <div
          {...rest}
          ref={dialogRef}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cx(styles.dialog, styles[size], className)}
        >
          {icon && (
            <div className={styles.icon} aria-hidden="true">
              {icon}
            </div>
          )}
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          )}
          {children && <div className={styles.content}>{children}</div>}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      </div>
    </Portal>
  );
}
