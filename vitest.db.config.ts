import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['./tests/db/setup/global-setup.ts'],
    // Docker startup on a cold image pull can take ~30s; hooks need 2x headroom.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Single Docker container + per-test pg.Pool — tests must run serially.
    threads: false,
  },
});
