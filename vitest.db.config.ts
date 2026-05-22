import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Standalone config — does NOT extend vitest.config.ts because the base
// setupFiles ('./vitest.setup.ts') hardcode `process.env.DATABASE_URL`
// to a non-existent test URL AND vi.mock @/lib/db with no-op stubs, which
// breaks service-layer integration tests that hit the real test container.
// We duplicate the alias table here so docker-backed tests can use `@/...`
// imports. Keep these in sync with vitest.config.ts when aliases change.
export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['./tests/db/setup/global-setup.ts'],
    // Docker startup on a cold image pull can take ~30s; hooks need 2x headroom.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Single Docker container + per-test pg.Pool — tests must run serially.
    threads: false,
    // Server-side DB tests — no DOM needed.
    environment: 'node',
  },
  resolve: {
    // IMPORTANT: More specific aliases must come before generic '@' otherwise
    // '@' → './src' will greedily match '@/lib/...' before the '@/lib' → './lib'
    // alias gets a chance to apply. Mirrors the ordering rationale in
    // vitest.config.ts — if you reorder this list, change vitest.config.ts too
    // (and vice versa). The duplication is deliberate, see header comment.
    alias: [
      // Specific @/lib/* paths that live in src/lib/ (mirrors tsconfig.json paths).
      // tsconfig maps @/lib/* to BOTH ./src/lib/* and ./lib/* (src first), but
      // Vitest alias only supports single-target matching, so each module that
      // lives in src/lib needs an explicit override before the generic
      // @/lib → ./lib fallback at the end.
      { find: '@sentry/nextjs', replacement: path.resolve(__dirname, 'src/lib/sentry/__stubs__/sentry-nextjs.ts') },
      { find: /^@\/lib\/sentry/, replacement: path.resolve(__dirname, 'src/lib/sentry') },
      { find: /^@\/lib\/observability/, replacement: path.resolve(__dirname, 'src/lib/observability') },
      { find: '@/lib/utils', replacement: path.resolve(__dirname, './src/lib/utils') },
      { find: '@/lib/db-neon', replacement: path.resolve(__dirname, './src/lib/db-neon') },
      { find: '@/lib/neon', replacement: path.resolve(__dirname, './src/lib/neon') },
      { find: '@/lib/db-pool', replacement: path.resolve(__dirname, './src/lib/db-pool') },
      { find: '@/lib/vlm', replacement: path.resolve(__dirname, './src/lib/vlm') },
      { find: '@/lib/arcjet', replacement: path.resolve(__dirname, './src/lib/arcjet') },
      { find: '@/lib/email', replacement: path.resolve(__dirname, './src/lib/email') },
      { find: '@/lib/dbCircuitBreaker', replacement: path.resolve(__dirname, './src/lib/dbCircuitBreaker') },
      { find: '@/lib/geo', replacement: path.resolve(__dirname, './src/lib/geo') },
      { find: '@/lib/apiResponse', replacement: path.resolve(__dirname, './src/lib/apiResponse') },
      // @/lib/auth-mock lives at root ./lib/ — the generic @/lib fallback
      // below doesn't get the chance because '@/lib/auth' (more specific)
      // matches first. Needs an explicit entry above the auth alias.
      { find: '@/lib/auth-mock', replacement: path.resolve(__dirname, './lib/auth-mock') },
      { find: '@/lib/auth', replacement: path.resolve(__dirname, './src/lib/auth') },
      { find: '@/lib/permissions', replacement: path.resolve(__dirname, './src/lib/permissions') },
      { find: '@/lib/logger', replacement: path.resolve(__dirname, './src/lib/logger') },
      // @/lib/hooks/* lives at src/lib/hooks/ — needed after useStockSync was
      // updated to import from '@/lib/hooks/useOnlineStatus' (bucket B refactor).
      { find: /^@\/lib\/hooks/, replacement: path.resolve(__dirname, './src/lib/hooks') },
      { find: '@/lib', replacement: path.resolve(__dirname, './lib') },
      { find: '@/components', replacement: path.resolve(__dirname, './src/components') },
      { find: '@/hooks', replacement: path.resolve(__dirname, './src/hooks') },
      { find: '@/types', replacement: path.resolve(__dirname, './src/types') },
      { find: '@/contexts', replacement: path.resolve(__dirname, './src/contexts') },
      { find: '@/services', replacement: path.resolve(__dirname, './src/services') },
      { find: '@/modules', replacement: path.resolve(__dirname, './src/modules') },
      { find: '@/pages', replacement: path.resolve(__dirname, './pages') },
      { find: '@/config', replacement: path.resolve(__dirname, './src/config') },
      // @/app → root-level app/ directory (App Router routes, e.g. app/api/noc/...)
      // Must come before generic '@' → './src' to prevent incorrect resolution.
      { find: '@/app', replacement: path.resolve(__dirname, './app') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
});
