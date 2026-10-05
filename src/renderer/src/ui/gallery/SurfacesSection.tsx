import { GlassPanel, type GlassVariant } from '../index';
import { Section, Specimen, Stage, type StageBackdrop } from './Section';
import styles from './SurfacesSection.module.css';

const VARIANTS: readonly GlassVariant[] = ['subtle', 'regular', 'strong'];
const BACKDROPS: readonly StageBackdrop[] = ['photo', 'white', 'canvas'];

export function SurfacesSection() {
  return (
    <Section
      id="surfaces"
      title="Glass surfaces"
      description="Every floating element is a GlassPanel. The same three variants are shown over the busy picture, pure white and the dark canvas: text must stay readable on all of them."
    >
      <div className={styles.stages}>
        {BACKDROPS.map((backdrop) => (
          <Stage key={backdrop} backdrop={backdrop} layout="column">
            {VARIANTS.map((variant) => (
              <Specimen key={variant} label={`${variant} · on ${backdrop}`} wide>
                <GlassPanel variant={variant} data-testid={`glass-${variant}-${backdrop}`}>
                  <p className={styles.title}>Reference melody ready</p>
                  <p className={styles.body}>Autotune will follow the original vocal line.</p>
                  <p className={styles.fine}>A♭ major · 96 notes · good match</p>
                </GlassPanel>
              </Specimen>
            ))}
          </Stage>
        ))}
      </div>
    </Section>
  );
}
