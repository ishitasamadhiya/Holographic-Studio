import type { CSSProperties, HTMLAttributes } from 'react';
import { cx } from './internal/classNames';
import { VisuallyHidden } from './VisuallyHidden';
import styles from './Stepper.module.css';

export interface StepperStep {
  id: string;
  /** Read by screen readers; not shown. */
  label: string;
}

export type StepperVariant = 'dots' | 'bar';

export interface StepperProps extends Omit<HTMLAttributes<HTMLOListElement>, 'children'> {
  steps: readonly StepperStep[];
  /** Index of the step the user is on. Earlier steps count as done. */
  currentIndex: number;
  variant?: StepperVariant;
  /** Accessible name of the list. */
  label?: string;
}

function stepState(index: number, currentIndex: number): 'done' | 'current' | 'upcoming' {
  if (index < currentIndex) return 'done';
  return index === currentIndex ? 'current' : 'upcoming';
}

const STATE_DESCRIPTIONS = { done: 'completed', current: 'current step', upcoming: 'not started' };

/** Quiet wizard progress: a row of dots, or a segmented bar for wider layouts. */
export function Stepper({
  steps,
  currentIndex,
  variant = 'dots',
  label = 'Setup progress',
  className,
  style,
  ...rest
}: StepperProps) {
  return (
    <ol
      aria-label={label}
      {...rest}
      className={cx(styles.stepper, styles[variant], className)}
      style={{ '--step-count': steps.length, ...style } as CSSProperties}
    >
      {steps.map((step, index) => {
        const state = stepState(index, currentIndex);
        return (
          <li
            key={step.id}
            className={styles.step}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <VisuallyHidden>
              {`Step ${index + 1} of ${steps.length}: ${step.label} (${STATE_DESCRIPTIONS[state]})`}
            </VisuallyHidden>
          </li>
        );
      })}
    </ol>
  );
}
