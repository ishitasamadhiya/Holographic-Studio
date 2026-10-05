// Developer page: renders every design-system component in isolation.
// Open with HOLO_E2E_PAGE=gallery.html (see docs/TESTING.md).
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (container) createRoot(container).render(<p>Component gallery</p>);
