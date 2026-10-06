import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the static build works under a GitHub Pages sub-path.
  base: './',
  build: {
    // Three.js loads as its own lazy chunk of about 560 kB (150 kB gzipped).
    chunkSizeWarningLimit: 650,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The agreement tests each run hundreds of full simulated trips.
    testTimeout: 60_000,
  },
});
