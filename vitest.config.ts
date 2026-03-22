import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'dist'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    // IMPORTANT: More specific aliases must come before generic '@'
    // otherwise '@' → './src' will greedily match '@/lib/...' before
    // the '@/lib' → './lib' alias gets a chance to apply.
    alias: [
      { find: '@/lib/utils', replacement: path.resolve(__dirname, './src/lib/utils') },
      { find: '@/lib/db-neon', replacement: path.resolve(__dirname, './src/lib/db-neon') },
      { find: '@/lib/neon', replacement: path.resolve(__dirname, './src/lib/neon') },
      { find: '@/lib', replacement: path.resolve(__dirname, './lib') },
      { find: '@/components', replacement: path.resolve(__dirname, './src/components') },
      { find: '@/hooks', replacement: path.resolve(__dirname, './src/hooks') },
      { find: '@/types', replacement: path.resolve(__dirname, './src/types') },
      { find: '@/contexts', replacement: path.resolve(__dirname, './src/contexts') },
      { find: '@/services', replacement: path.resolve(__dirname, './src/services') },
      { find: '@/modules', replacement: path.resolve(__dirname, './src/modules') },
      { find: '@/pages', replacement: path.resolve(__dirname, './pages') },
      { find: '@/config', replacement: path.resolve(__dirname, './src/config') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  esbuild: {
    jsx: 'automatic',
  },
});
