import { AppMark } from '../index';
import { Section } from './Section';
import styles from './FoundationsSection.module.css';

const SWATCHES = [
  { name: 'Canvas', value: 'var(--color-canvas)' },
  { name: 'Glass', value: 'var(--glass-fill-strong)' },
  { name: 'Text', value: 'var(--color-text-primary)' },
  { name: 'Text 2', value: 'var(--color-text-secondary)' },
  { name: 'Text 3', value: 'var(--color-text-tertiary)' },
  { name: 'Holographic', value: 'var(--holo-gradient)' },
  { name: 'Record', value: 'var(--color-record)' },
  { name: 'Success', value: 'var(--color-success)' },
  { name: 'Warning', value: 'var(--color-warning)' },
  { name: 'Danger', value: 'var(--color-danger)' },
];

const TYPE_SCALE = [
  { token: '--text-4xl', sample: '01:24', weight: 600 },
  { token: '--text-3xl', sample: 'Add your song', weight: 600 },
  { token: '--text-2xl', sample: 'Ready to record', weight: 600 },
  { token: '--text-xl', sample: 'Settings', weight: 600 },
  { token: '--text-lg', sample: 'Choose the backing track you will sing over.', weight: 400 },
  { token: '--text-md', sample: 'Your processed voice in the headphones', weight: 400 },
  { token: '--text-sm', sample: 'Drop a file or click to browse', weight: 500 },
  { token: '--text-xs', sample: 'Autotune · Echo · Volume', weight: 500 },
];

const SPACING = ['1', '2', '3', '4', '5', '6', '8', '10', '12', '16'];

const RADII = [
  '--radius-xs',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-2xl',
];

export function FoundationsSection() {
  return (
    <Section
      id="foundations"
      title="Foundations"
      description="Dark canvas, near-white text, one pale iridescent accent, and red only for recording."
    >
      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <AppMark size={44} title="Holographic Studio" />
            <div>
              <p className={styles.brandName}>Holographic Studio</p>
              <p className={styles.caption}>App mark</p>
            </div>
          </div>
          <ul className={styles.swatches}>
            {SWATCHES.map((swatch) => (
              <li key={swatch.name} className={styles.swatch}>
                <span className={styles.swatchChip} style={{ background: swatch.value }} />
                <span className={styles.caption}>{swatch.name}</span>
              </li>
            ))}
          </ul>
          <ul className={styles.radii}>
            {RADII.map((token) => (
              <li key={token} className={styles.radius}>
                <span className={styles.radiusChip} style={{ borderRadius: `var(${token})` }} />
                <span className={styles.caption}>{token.replace('--radius-', '')}</span>
              </li>
            ))}
          </ul>
          <ul className={styles.spacing}>
            {SPACING.map((step) => (
              <li key={step} className={styles.space}>
                <span className={styles.spaceBar} style={{ width: `var(--space-${step})` }} />
                <span className={styles.caption}>{step}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.card}>
          <ul className={styles.typeScale}>
            {TYPE_SCALE.map((row) => (
              <li key={row.token} className={styles.typeRow}>
                <span className={styles.caption}>{row.token.replace('--text-', '')}</span>
                <span style={{ fontSize: `var(${row.token})`, fontWeight: row.weight }}>
                  {row.sample}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
