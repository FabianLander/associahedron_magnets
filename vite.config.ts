import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// base: './' so the built site works from any subpath (GitHub Pages serves the
// repo at /<repo>/). Ring aliases mirror tsconfig + vitest.
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@display': fileURLToPath(new URL('./src/display', import.meta.url)),
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
