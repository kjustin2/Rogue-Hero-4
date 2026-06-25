import { defineConfig } from 'vite';

// base './' keeps asset URLs relative so the build works from file:// (Electron) too.
export default defineConfig({
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2020', outDir: 'dist', sourcemap: false },
});
