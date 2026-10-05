import * as icons from '../icons';
import { Section } from './Section';
import styles from './IconsSection.module.css';

const ICONS = Object.entries(icons)
  .filter((entry): entry is [string, icons.IconComponent] => entry[0].endsWith('Icon'))
  .sort(([first], [second]) => first.localeCompare(second));

export function IconsSection() {
  return (
    <Section
      id="icons"
      title="Icons"
      description="One inline-SVG set on a 24 px grid with 1.75 px round strokes, drawn in the current text colour."
    >
      <ul className={styles.grid} data-testid="icon-grid">
        {ICONS.map(([name, Icon]) => (
          <li key={name} className={styles.cell}>
            <Icon size={24} />
            <span className={styles.name}>{name.replace(/Icon$/, '')}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
