import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Migration execution tests — the ones that apply real SQL to a real Postgres.
 *
 * These exist because unit tests drive services through a stub TxnClient that
 * records SQL text and never sends it, so they are structurally blind to
 * anything Postgres decides at parse time. A 42P08 shipped a 500 on every
 * verify and revoke past green CI and five reviewers; migration 471's test is
 * what catches that class. Until this config existed the file ran nowhere.
 *
 * Standalone rather than extending vitest.config.ts, for the same reason
 * vitest.db.config.ts is: the base setupFiles pin DATABASE_URL to a fake and
 * vi.mock @/lib/db with no-op stubs, which defeats a test whose entire purpose
 * is to reach a real database.
 *
 * Alias table is deliberately minimal — the migration tests import almost
 * nothing. 471 imports the lifecycle service at runtime (hence @/modules);
 * every @/lib reference in that closure is `import type` and is erased before
 * it reaches the resolver. Add entries here only when a test genuinely needs
 * them, rather than copying the ~90-entry table from vitest.config.ts.
 */
export default defineConfig({
  test: {
    include: ['tests/migrations/**/*.test.ts'],
    exclude: [
      // Both fail on SEED FIDELITY, not on the migrations they test. Diagnosis
      // recorded so picking them up does not start from zero.
      //
      //   358 — reads and writes `snag_reports`, which neither seed.sql nor
      //   zone-delivery-seed.sql creates. Needs that table added to a seed,
      //   mirroring the live shape.
      'tests/migrations/358_snag_reports_scope.test.ts',
      //   378 — gets as far as applying its migration, then dies on
      //   `column "executed_at" of relation "migrations" does not exist`. The
      //   seed's `migrations` table is (version INTEGER, name, applied_at);
      //   production's is (id, version VARCHAR, name, executed_at,
      //   execution_time_ms, success, error_message). Fixing it means editing
      //   a seed tests/db/** also loads, including a column TYPE change on
      //   `version`, so it needs its own pass with those tests re-run.
      'tests/migrations/378_rbac_field_stock_force_correct.test.ts',
    ],
    globalSetup: ['./tests/migrations/setup/global-setup.ts'],
    // Docker start + seed is ~10-20s on a warm image; individual tests apply
    // whole migration files, so both need more headroom than the unit default.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // These hit one shared container; parallel files would race on the same
    // tables and on migration application order.
    //
    // `threads: false`, NOT `fileParallelism: false`. This repo is on vitest 0.34.6 and
    // fileParallelism landed in vitest 1.0 — the string appears nowhere in
    // node_modules/vitest/dist, so it was accepted and silently ignored, and these files
    // have been running in PARALLEL the whole time despite the comment above.
    //
    // What that cost: 497 and 498 both `CREATE EXTENSION IF NOT EXISTS btree_gist`.
    // That statement is check-then-insert and is not atomic, so two files running it at
    // once both saw "not exists" and one lost the insert with
    // 23505 duplicate key value violates unique constraint "pg_extension_name_index".
    // It failed twice on CI (including a clean re-run) while passing locally, which is
    // what a parallelism race looks like on a runner with more cores.
    //
    // The three sibling DB configs — vitest.db.config.ts, vitest.db.sprinte.config.ts,
    // vitest.velocity-review-db.config.ts — all already use `threads: false`. This one
    // was the odd one out. See scripts/__tests__/vitest-config-options.test.ts, which
    // fails if an option unsupported by the installed vitest reappears in any config.
    threads: false,
  },
  resolve: {
    alias: [
      { find: '@/modules', replacement: path.resolve(__dirname, './src/modules') },
      { find: '@/lib/db-pool', replacement: path.resolve(__dirname, './src/lib/db-pool') },
      // db-pool's own closure: src/lib/db.ts imports both of these, and the
      // generic @/lib fallback below would send them to ./lib, where only
      // logger exists. Needed by any test that drives real service SQL rather
      // than applying a migration file (483_fleet_parking_queries).
      { find: '@/lib/dbCircuitBreaker', replacement: path.resolve(__dirname, './src/lib/dbCircuitBreaker') },
      // dbCircuitBreaker imports this; it lives under src/lib, so without an entry
      // the generic @/lib fallback below sends it to ./lib and the import fails.
      { find: '@/lib/waBridgeAuth', replacement: path.resolve(__dirname, './src/lib/waBridgeAuth') },
      { find: '@/lib/logger', replacement: path.resolve(__dirname, './src/lib/logger') },
      // approvalQueries measures how far a driver moved their address, so the
      // parking approval test's closure reaches haversineDistanceM.
      { find: '@/lib/geo', replacement: path.resolve(__dirname, './src/lib/geo') },
      // The roster's schedule resolver reaches services/attendance/reconcileQueries,
      // whose closure includes employmentUniverse -> @/lib/staff/hrVisibilityFilters.
      // That one lives under src/lib, not lib, so the generic @/lib fallback below
      // would send it to the wrong tree.
      { find: '@/lib/staff', replacement: path.resolve(__dirname, './src/lib/staff') },
      // Hold-authority recipient resolution defers the decision to
      // userHasPermission, which lives under src/lib, not lib.
      { find: '@/lib/permissions', replacement: path.resolve(__dirname, './src/lib/permissions') },
      { find: '@/lib', replacement: path.resolve(__dirname, './lib') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
});
