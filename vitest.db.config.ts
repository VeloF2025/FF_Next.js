import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['./tests/db/setup/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    threads: false,
  },
});
