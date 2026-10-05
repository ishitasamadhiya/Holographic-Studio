import { type HTMLAttributes, type ReactNode, useId, useRef } from 'react';
import { IconButton } from './IconButton';
import { CloseIcon } from './icons';
import { cx } from './internal/classNames';
import { Portal } from './internal/Portal';
import { useModalLayer } from './internal/useModalLayer';
import { usePresence } from './internal/usePresence';
import styles from './Sheet.module.css';

export interface SheetProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'role'> {
  open: boolean;
  /** Called for Escape, the close button and a click outside the panel. */
  onClose: () => void;
  title: string;
  /** One line under the title. */
  description?: string;
  /** The scrollable content. */
  children: ReactNode;
  /** Pinned below the scroll area, e.g. a "Done" button. */
  footer?: ReactNode;
  /** Panel width in CSS pixels. */
  width?: number;
}

/**
 * A glass panel that slides in from the right edge (Settings). The video stays visible beside
 * it so changes can be judged live. Focus is trapped inside while it is open.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 380,
  className,
  style,
  ...rest
}: SheetProps) {
  const { rendered, exiting } = usePresence(open);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useModalLayer({ containerRef: panelRef, active: rendered && !exiting, onEscape: onClose });

  if (!rendered) return null;

  return (
    <Portal>
      <div className={cx(styles.layer, exiting && styles.exiting)}>
        <div className={styles.scrim} onClick={onClose} />
        <aside
          {...rest}
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cx(styles.panel, className)}
          style={{ width, ...style }}
        >
          <header className={styles.header}>
            <div className={styles.heading}>
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className={styles.description}>
                  {description}
                </p>
              )}
            </div>
            <IconButton label="Close" variant="ghost" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </header>
          <div className={styles.content}>{children}</div>
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </aside>
      </div>
    </Portal>
  );
}
