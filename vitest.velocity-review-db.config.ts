import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/db/velocity-review/*.test.ts'],
    globalSetup: ['./tests/db/velocity-review/global-setup.ts'],
    environment: 'node',
    threads: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(__dirname, './src') }],
  },
});
