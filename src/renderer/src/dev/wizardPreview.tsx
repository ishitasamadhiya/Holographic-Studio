// Developer page: renders the wizard screens against fixed state (see docs/TESTING.md).
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (container) createRoot(container).render(<p>Wizard Preview</p>);
