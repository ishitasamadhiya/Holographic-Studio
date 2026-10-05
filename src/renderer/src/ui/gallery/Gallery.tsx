import { useEffect, useState } from 'react';
import { AppMark, Button, ChevronLeftIcon, cx, SegmentedControl, ToastViewport } from '../index';
import { ButtonsSection } from './ButtonsSection';
import { FeedbackSection } from './FeedbackSection';
import { FoundationsSection } from './FoundationsSection';
import { IconsSection } from './IconsSection';
import { InputsSection } from './InputsSection';
import { MetersSection } from './MetersSection';
import { OverlaysSection } from './OverlaysSection';
import { Section } from './Section';
import { StudioMock } from './StudioMock';
import { SurfacesSection } from './SurfacesSection';
import { WizardMock } from './WizardMock';
import styles from './Gallery.module.css';

/** `components` is the scrolling catalogue; the others fill the window like the real app. */
type GalleryView = 'components' | 'studio' | 'wizard' | 'settings';

const VIEW_OPTIONS = [
  { value: 'components', label: 'Components' },
  { value: 'studio', label: 'Studio' },
  { value: 'wizard', label: 'Wizard' },
  { value: 'settings', label: 'Settings' },
] as const;

function viewFromHash(hash: string): GalleryView {
  const name = hash.replace(/^#/, '');
  return VIEW_OPTIONS.some((option) => option.value === name)
    ? (name as GalleryView)
    : 'components';
}

/** The view lives in the URL hash (gallery.html#studio) so it survives reloads and can be linked. */
function useHashView(): [GalleryView, (view: GalleryView) => void] {
  const [view, setView] = useState(() => viewFromHash(window.location.hash));

  useEffect(() => {
    const handleHashChange = () => setView(viewFromHash(window.location.hash));
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = (next: GalleryView) => {
    window.location.hash = next === 'components' ? '' : next;
  };
  return [view, navigate];
}

function ComponentsView({ onNavigate }: { onNavigate: (view: GalleryView) => void }) {
  return (
    <div className={styles.page}>
      <header
        className={cx(styles.header, 'app-drag', 'titlebar-safe-area')}
        data-testid="gallery-header"
      >
        <div className={styles.headerTitle}>
          <AppMark size={22} />
          <h1 className={styles.title}>Component gallery</h1>
        </div>
        <SegmentedControl
          label="Gallery view"
          size="sm"
          options={VIEW_OPTIONS}
          value="components"
          onChange={onNavigate}
          data-testid="gallery-view-switch"
        />
      </header>

      <main className={styles.sections}>
        <FoundationsSection />
        <SurfacesSection />
        <ButtonsSection />
        <InputsSection />
        <MetersSection />
        <FeedbackSection />
        <OverlaysSection />
        <IconsSection />

        <Section
          id="studio-preview"
          title="Composed: studio screen"
          description="Everything together over a busy picture. Open the Studio view to see it at full window size."
        >
          <div className={styles.frame}>
            <StudioMock showWindowChrome />
          </div>
        </Section>
        <Section
          id="wizard-preview"
          title="Composed: first-run wizard"
          description="A single wizard step as a glass card on the dark canvas."
        >
          <div className={styles.frame}>
            <WizardMock />
          </div>
        </Section>
      </main>
    </div>
  );
}

export function Gallery() {
  const [view, navigate] = useHashView();

  return (
    <div className={styles.root} data-testid="gallery-root" data-view={view}>
      {view === 'components' ? (
        <ComponentsView onNavigate={navigate} />
      ) : (
        <div className={styles.fullView}>
          {view === 'wizard' ? (
            <WizardMock />
          ) : (
            // Keyed so switching between the two remounts the mock with the right sheet state.
            <StudioMock key={view} settingsInitiallyOpen={view === 'settings'} />
          )}
          <Button
            size="sm"
            iconStart={<ChevronLeftIcon />}
            className={styles.back}
            onClick={() => navigate('components')}
            data-testid="gallery-back"
          >
            Gallery
          </Button>
        </div>
      )}
      <ToastViewport />
    </div>
  );
}
