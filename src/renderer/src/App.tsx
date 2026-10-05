import { useEffect } from 'react';
import { WizardScreen } from '@renderer/features/wizard';
import { StudioScreen } from '@renderer/features/studio';
import { useStudioState } from '@renderer/state/studioContext';
import { Spinner } from '@renderer/ui';

/** The app shell: shows the setup wizard on first run and the studio afterwards. */
export function App() {
  const phase = useStudioState((state) => state.phase);
  const platform = useStudioState((state) => state.appInfo?.platform);

  // The design system reserves room for the macOS window buttons only on macOS.
  useEffect(() => {
    if (platform) document.documentElement.dataset.platform = platform;
  }, [platform]);

  // A file dropped outside a drop zone must never be opened by the window itself.
  useEffect(() => {
    const ignore = (event: DragEvent) => {
      if (!event.defaultPrevented) event.preventDefault();
    };
    window.addEventListener('dragover', ignore);
    window.addEventListener('drop', ignore);
    return () => {
      window.removeEventListener('dragover', ignore);
      window.removeEventListener('drop', ignore);
    };
  }, []);

  if (phase === 'wizard') return <WizardScreen />;
  if (phase === 'studio') return <StudioScreen />;
  return (
    <main
      data-testid="app-loading"
      className="app-drag"
      style={{ height: '100vh', display: 'grid', placeItems: 'center' }}
    >
      <Spinner label="Starting Holographic Studio" />
    </main>
  );
}
