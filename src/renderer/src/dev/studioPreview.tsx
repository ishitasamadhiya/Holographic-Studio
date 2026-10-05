// Developer page: renders the studio screens against fixed state (see docs/TESTING.md).
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (container) createRoot(container).render(<p>Studio Preview</p>);
