// Developer page: starts the audio engine on its own and exposes it for inspection.
// Open with HOLO_E2E_PAGE=engine-probe.html (see docs/TESTING.md).
const container = document.getElementById('root');
if (container) container.textContent = 'Audio engine probe';
