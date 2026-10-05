import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@dsp': resolve(__dirname, 'src/dsp'),
      '@analysis': resolve(__dirname, 'src/analysis'),
      '@gestures': resolve(__dirname, 'src/gestures'),
      '@mixdown': resolve(__dirname, 'src/mixdown'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
