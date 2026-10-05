import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { CheckIcon } from '@renderer/ui';
import styles from './ChoiceCards.module.css';

export interface ChoiceOption<T extends string> {
  value: T;
  title: string;
  /** One short sentence under the title. */
  detail: string;
  icon: ReactNode;
}

export interface ChoiceCardsProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'data-testid'?: string;
}

const STEP_BY_KEY: Record<string, 1 | -1> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * A few large, mutually exclusive choices shown side by side. Behaves as a radio group:
 * one tab stop, arrow keys move the selection.
 */
export function ChoiceCards<T extends string>({
  label,
  options,
  value,
  onChange,
  ...rest
}: ChoiceCardsProps<T>) {
  const cards = useRef(new Map<T, HTMLButtonElement>());

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP_BY_KEY[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const current = options.findIndex((option) => option.value === value);
    const next = options[(current + step + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    cards.current.get(next.value)?.focus();
  };

  return (
    <div
      {...rest}
      role="radiogroup"
      aria-label={label}
      className={styles.group}
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const isChosen = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              if (element) cards.current.set(option.value, element);
              else cards.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={isChosen}
            tabIndex={isChosen ? 0 : -1}
            className={styles.card}
            data-value={option.value}
            onClick={() => onChange(option.value)}
          >
            <span className={styles.icon} aria-hidden="true">
              {option.icon}
            </span>
            <span className={styles.text}>
              <span className={styles.title}>{option.title}</span>
              <span className={styles.detail}>{option.detail}</span>
            </span>
            <span className={styles.mark} aria-hidden="true">
              <CheckIcon size={12} strokeWidth={2.75} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
