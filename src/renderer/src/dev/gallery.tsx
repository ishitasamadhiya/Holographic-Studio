// Developer page: every design-system component in all its states, plus composed mocks of
// the studio screen, the wizard and the settings sheet. It is never linked from the app.
// Open it with HOLO_E2E_PAGE=gallery.html; add #studio, #wizard or #settings for the
// full-window mocks.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Gallery } from '@renderer/ui/gallery/Gallery';

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from gallery.html');

createRoot(container).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
