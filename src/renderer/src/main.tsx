// Composition root: builds the one real Studio and renders the app around it.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StudioProvider } from '@renderer/state/studioContext';
import type { Studio } from '@renderer/state/studioTypes';
import { createStudio } from '@renderer/studio/createStudio';
import { App } from './App';

declare global {
  interface Window {
    /** The running Studio, exposed only to the end-to-end tests (HOLO_E2E=1). */
    __holoTest?: Studio;
  }
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from index.html');

const studio = createStudio();

// Exposed as soon as the app knows it is under test, before the devices have started.
const stopWatchingAppInfo = studio.store.subscribe((state) => {
  if (!state.appInfo) return;
  stopWatchingAppInfo();
  if (state.appInfo.isE2E) window.__holoTest = studio;
});

void studio.actions.initialize();

createRoot(container).render(
  <StrictMode>
    <StudioProvider studio={studio}>
      <App />
    </StudioProvider>
  </StrictMode>,
);
