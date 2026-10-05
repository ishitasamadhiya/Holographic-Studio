import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// HOLO_OUT_DIR lets parallel builds (e.g. two test runs) write to separate folders.
const outRoot = resolve(__dirname, process.env.HOLO_OUT_DIR ?? 'out');

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@dsp': resolve(__dirname, 'src/dsp'),
  '@analysis': resolve(__dirname, 'src/analysis'),
  '@gestures': resolve(__dirname, 'src/gestures'),
  '@mixdown': resolve(__dirname, 'src/mixdown'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
};

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      outDir: resolve(outRoot, 'main'),
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: resolve(outRoot, 'preload'),
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    worker: { format: 'es' },
    build: {
      outDir: resolve(outRoot, 'renderer'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // Developer-only pages (never linked from the app UI); see docs/TESTING.md.
          gallery: resolve(__dirname, 'src/renderer/gallery.html'),
          'tracking-probe': resolve(__dirname, 'src/renderer/tracking-probe.html'),
          'engine-probe': resolve(__dirname, 'src/renderer/engine-probe.html'),
          'wizard-preview': resolve(__dirname, 'src/renderer/wizard-preview.html'),
          'studio-preview': resolve(__dirname, 'src/renderer/studio-preview.html'),
        },
      },
    },
  },
});
