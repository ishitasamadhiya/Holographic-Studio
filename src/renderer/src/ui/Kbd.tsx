import type { HTMLAttributes } from 'react';
import { cx } from './internal/classNames';
import styles from './Kbd.module.css';

/** A keyboard key hint, e.g. <Kbd>Space</Kbd>. */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <kbd className={cx(styles.kbd, className)} {...rest} />;
}
