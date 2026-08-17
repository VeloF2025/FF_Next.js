/**
 * vitest.db.sprinte.config.ts
 *
 * Vitest config for Sprint E lifecycle integration tests.
 * Scoped to tests/db/services/field-stock/serialLifecycle.test.ts (and any
 * future tests/db/sprint-e/ tests).
 *
 * Uses sprint-e-global-setup.ts which extends the base seed with migrations
 * 383/384/387 so the lifecycle triggers are installed in the test container.
 *
 * WHY SEPARATE: mig 387 installs BEFORE UPDATE triggers that reject raw status
 * writes not routed through promoteSerial. The base tests/db/** tests issue
 * exactly those raw writes in their setup helpers. Loading mig 387 into
 * global-setup.ts would break 30+ existing tests. This config isolates the
 * Sprint E test files so they get the full trigger harness without disturbing
 * the rest of the test suite.
 *
 * Usage:
 *   npx vitest run --config vitest.db.sprinte.config.ts
 *   npm run test:db:sprinte   (if added to package.json)
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    // Sprint E lifecycle tests only (require mig 387 triggers via sprint-e-global-setup)
    include: [
      'tests/db/services/field-stock/serialLifecycle.test.ts',
      'tests/db/services/field-stock/consumptionService.lifecycle.test.ts',
      'tests/db/services/field-stock/pickingProcess.lifecycle.test.ts',
      // Task 2.3 (Track 2) — returns accept handler serial lifecycle
      'tests/db/services/field-stock/returnsAccept.lifecycle.test.ts',
      // Task 2.4 (Track 2) — cascade PP resolution serial lifecycle
      'tests/db/services/activate/cascadePpResolution.lifecycle.test.ts',
      'tests/db/serialLifecycleMatrix.test.ts',
      // Track 2.6 — remaining direct serial-status callers
      'tests/db/services/field-stock/scanSerialService.lifecycle.test.ts',
      'tests/db/services/field-stock/serialForceCorrect.lifecycle.test.ts',
      'tests/db/services/activate/oesActivation.lifecycle.test.ts',
      // #1860 regrowth fix — durable OES in_stock→activated reconciliation
      'tests/db/services/activate/oesReconcileInStock.lifecycle.test.ts',
      // Track 2.7 — verify legacy trigger retirement + generic trigger presence
      'tests/db/migrations/track27RetireTriggers.test.ts',
      // Track 4.1 — issue-time block enforcement (SOP-4.4)
      'tests/db/services/field-stock/holderBlockGuard.lifecycle.test.ts',
      // #1864 — ONT/Gizzu stock-receipt genesis intake
      'tests/db/services/field-stock/serialIntake.lifecycle.test.ts',
    ],
    globalSetup: ['./tests/db/setup/sprint-e-global-setup.ts'],
    // Docker startup on cold pull can take ~30s; hooks need 2x headroom.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Single Docker container + per-test pg.Pool — run serially.
    threads: false,
    // Server-side DB tests — no DOM needed.
    environment: 'node',
  },
  resolve: {
    // Mirrors the alias table in vitest.db.config.ts exactly. Must stay in
    // sync when aliases change. Duplication is intentional — see that file's
    // header comment for the rationale.
    alias: [
      { find: '@sentry/nextjs', replacement: path.resolve(__dirname, 'src/lib/sentry/__stubs__/sentry-nextjs.ts') },
      // Replace the Neon HTTP driver with the pg-pool shim so service functions
      // that still import from '@neondatabase/serverless' work against the local
      // Docker test container (which speaks the Postgres wire protocol, not HTTP).
      { find: '@neondatabase/serverless', replacement: path.resolve(__dirname, 'src/lib/neon-shim.ts') },
      { find: /^@\/lib\/sentry/, replacement: path.resolve(__dirname, 'src/lib/sentry') },
      { find: /^@\/lib\/observability/, replacement: path.resolve(__dirname, 'src/lib/observability') },
      { find: '@/lib/rateLimiter', replacement: path.resolve(__dirname, './src/lib/rateLimiter') },
      { find: '@/lib/photos', replacement: path.resolve(__dirname, './src/lib/photos') },
      { find: '@/lib/meetings', replacement: path.resolve(__dirname, './src/lib/meetings') },
      { find: '@/lib/reporting', replacement: path.resolve(__dirname, './src/lib/reporting') },
      { find: '@/lib/actionItems', replacement: path.resolve(__dirname, './src/lib/actionItems') },
      { find: '@/lib/utils', replacement: path.resolve(__dirname, './src/lib/utils') },
      { find: '@/lib/db-neon', replacement: path.resolve(__dirname, './src/lib/db-neon') },
      { find: '@/lib/neon', replacement: path.resolve(__dirname, './src/lib/neon') },
      { find: '@/lib/db-pool', replacement: path.resolve(__dirname, './src/lib/db-pool') },
      { find: /^@\/lib\/db/, replacement: path.resolve(__dirname, './src/lib/db') },
      { find: '@/lib/vlm', replacement: path.resolve(__dirname, './src/lib/vlm') },
      { find: '@/lib/arcjet', replacement: path.resolve(__dirname, './src/lib/arcjet') },
      { find: '@/lib/email', replacement: path.resolve(__dirname, './src/lib/email') },
      { find: '@/lib/dbCircuitBreaker', replacement: path.resolve(__dirname, './src/lib/dbCircuitBreaker') },
      { find: '@/lib/geo', replacement: path.resolve(__dirname, './src/lib/geo') },
      { find: '@/lib/apiResponse', replacement: path.resolve(__dirname, './src/lib/apiResponse') },
      { find: '@/lib/serial-events', replacement: path.resolve(__dirname, './src/lib/serial-events') },
      { find: '@/lib/auth-mock', replacement: path.resolve(__dirname, './lib/auth-mock') },
      { find: '@/lib/auth', replacement: path.resolve(__dirname, './src/lib/auth') },
      { find: '@/lib/permissions', replacement: path.resolve(__dirname, './src/lib/permissions') },
      { find: '@/lib/logger', replacement: path.resolve(__dirname, './src/lib/logger') },
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
      { find: '@/app', replacement: path.resolve(__dirname, './app') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
});
