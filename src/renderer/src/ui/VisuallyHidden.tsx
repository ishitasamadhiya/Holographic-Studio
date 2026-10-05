import type { HTMLAttributes } from 'react';
import { cx } from './internal/classNames';

/** Text that only assistive technology can perceive. */
export function VisuallyHidden({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('visually-hidden', className)} {...rest} />;
}
