import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC transforms the decorators and emits the metadata NestJS relies on for
// dependency injection — plain esbuild (Vitest's default) does not.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    root: './',
    // Integration tests share a single Postgres database, so run files serially.
    fileParallelism: false,
    hookTimeout: 30_000,
  },
  plugins: [swc.vite()],
});
