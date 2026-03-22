/**
 * vitest.unit.config.ts
 * Dedicated config for src/__tests__/unit/** unit tests.
 * Extends the base aliases and adds missing src/lib aliases that the
 * default vitest.config.ts (which points @/lib → ./lib for Next.js compat)
 * doesn't cover.
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/__tests__/unit/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
  resolve: {
    alias: [
      // Specific src/lib overrides MUST come before the generic @/lib catch-all
      { find: '@/lib/db-neon', replacement: path.resolve(__dirname, './src/lib/db-neon') },
      { find: '@/lib/neon',    replacement: path.resolve(__dirname, './src/lib/neon') },
      { find: '@/lib/utils',   replacement: path.resolve(__dirname, './src/lib/utils') },
      { find: '@/lib',         replacement: path.resolve(__dirname, './lib') },
      // Other module aliases
      { find: '@/components',  replacement: path.resolve(__dirname, './src/components') },
      { find: '@/hooks',       replacement: path.resolve(__dirname, './src/hooks') },
      { find: '@/types',       replacement: path.resolve(__dirname, './src/types') },
      { find: '@/contexts',    replacement: path.resolve(__dirname, './src/contexts') },
      { find: '@/services',    replacement: path.resolve(__dirname, './src/services') },
      { find: '@/modules',     replacement: path.resolve(__dirname, './src/modules') },
      { find: '@/pages',       replacement: path.resolve(__dirname, './pages') },
      { find: '@/config',      replacement: path.resolve(__dirname, './src/config') },
      { find: '@',             replacement: path.resolve(__dirname, './src') },
    ],
  },
  esbuild: {
    jsx: 'automatic',
  },
});
