import type { ReactNode } from 'react';
import { cx } from '../index';
import { WebcamBackdrop } from './WebcamBackdrop';
import styles from './Section.module.css';

export interface SectionProps {
  id: string;
  title: string;
  /** One sentence on what to look for. */
  description?: string;
  children: ReactNode;
}

/** A titled block of the gallery page. */
export function Section({ id, title, description, children }: SectionProps) {
  return (
    <section
      className={styles.section}
      data-testid={`section-${id}`}
      aria-labelledby={`${id}-title`}
    >
      <header className={styles.sectionHeader}>
        <h2 id={`${id}-title`} className={styles.sectionTitle}>
          {title}
        </h2>
        {description && <p className={styles.sectionDescription}>{description}</p>}
      </header>
      {children}
    </section>
  );
}

export type StageBackdrop = 'photo' | 'white' | 'canvas';
export type StageLayout = 'row' | 'column' | 'grid';

export interface StageProps {
  /** What the components sit on: the pretend webcam picture, pure white, or the dark canvas. */
  backdrop?: StageBackdrop;
  layout?: StageLayout;
  children: ReactNode;
  className?: string;
}

/** A framed surface for showing components over a chosen backdrop. */
export function Stage({ backdrop = 'photo', layout = 'row', children, className }: StageProps) {
  return (
    <div className={cx(styles.stage, styles[backdrop], className)}>
      {backdrop === 'photo' && <WebcamBackdrop className={styles.stagePhoto} />}
      <div className={cx(styles.stageContent, styles[layout])}>{children}</div>
    </div>
  );
}

export interface SpecimenProps {
  /** Caption under the component. */
  label: string;
  children: ReactNode;
  /** Lets the specimen take the full row (for wide components). */
  wide?: boolean;
}

/** One captioned example inside a Stage. */
export function Specimen({ label, children, wide = false }: SpecimenProps) {
  return (
    <figure className={cx(styles.specimen, wide && styles.specimenWide)}>
      <div className={styles.specimenBody}>{children}</div>
      <figcaption className={styles.specimenLabel}>{label}</figcaption>
    </figure>
  );
}
