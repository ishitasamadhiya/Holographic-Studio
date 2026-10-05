import { useStudioState } from '@renderer/state/studioContext';
import { Kbd } from '@renderer/ui';
import styles from './KeyboardHints.module.css';

interface KeyboardHint {
  keys: readonly string[];
  /** How the keys are read out, e.g. "Up and Down arrows". */
  spoken: string;
  action: string;
}

function keyboardHints(settingsModifier: string): KeyboardHint[] {
  return [
    { keys: ['R'], spoken: 'R', action: 'Record / stop' },
    { keys: ['Space'], spoken: 'Space', action: 'Pause / preview' },
    { keys: ['↑', '↓'], spoken: 'Up and Down arrows', action: 'Autotune' },
    { keys: ['←', '→'], spoken: 'Left and Right arrows', action: 'Echo' },
    { keys: ['−', '='], spoken: 'Minus and Equals', action: 'Volume' },
    { keys: ['M'], spoken: 'M', action: 'Hear yourself' },
    { keys: [settingsModifier, ','], spoken: `${settingsModifier} Comma`, action: 'Settings' },
    { keys: ['Esc'], spoken: 'Escape', action: 'Cancel' },
  ];
}

/** The studio's keyboard shortcuts as a compact two-column list. */
export function KeyboardHints() {
  const platform = useStudioState((state) => state.appInfo?.platform ?? 'darwin');
  const hints = keyboardHints(platform === 'darwin' ? '⌘' : 'Ctrl');

  return (
    <section
      className={styles.section}
      aria-label="Keyboard shortcuts"
      data-testid="keyboard-hints"
    >
      <h3 className={styles.title}>Keyboard</h3>
      <ul className={styles.list}>
        {hints.map((hint) => (
          <li key={hint.action} className={styles.hint}>
            <span className={styles.keys} aria-hidden="true">
              {hint.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
            <span className="visually-hidden">{hint.spoken}:</span>
            <span className={styles.action}>{hint.action}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
