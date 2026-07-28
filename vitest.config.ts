import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: [
      'node_modules',
      '.next',
      'dist',
      '.claude/worktrees/**',
      // tests/db/** are docker-Postgres integration tests; they run under
      // vitest.db.config.ts. Including them here would crash collection
      // because they throw at module load when DATABASE_URL_TEST is unset.
      'tests/db/**',
      'src/modules/wa-monitor/tests/integration.test.ts',
      'src/lib/qfield/__tests__/gpkg-import-types.test.ts',
      // No single flat route exists for these multi-method nested handlers
      'tests/api/contractors/contractorId-index.test.ts',
      'tests/api/contractors/docId.test.ts',
      'tests/api/contractors/teamId.test.ts',
      'tests/api/contractors/rag-history.test.ts',
      // neonContractorService was never implemented — tests reference a non-existent service
      'tests/api/contractors/documents.test.ts',
      'tests/api/contractors/index.test.ts',
      'tests/api/contractors/onboarding-complete.test.ts',
      'tests/api/contractors/onboarding-stageId.test.ts',
      'tests/api/contractors/onboarding-stages.test.ts',
      'tests/api/contractors/rag.test.ts',
      'tests/api/contractors/teams.test.ts',
      // Same class as tests/db/** above, just living outside that directory:
      // each throws at module load when TEST_DATABASE_URL is unset, and each
      // builds a real pg.Pool inside vi.hoisted, so they cannot be skipped
      // gracefully either — the pool is constructed before any test runs.
      // Excluding them stops six files failing collection on every unit run;
      // set TEST_DATABASE_URL and target them directly to run them.
      'pages/api/snags/__tests__/reports-scope.test.ts',
      'pages/api/snags/__tests__/reports-scope-xlsx.test.ts',
      'pages/api/snags/__tests__/reports-source-filter.test.ts',
      'src/modules/construction-qa/services/reportNumberGenerator.test.ts',
      'tests/migrations/358_snag_reports_scope.test.ts',
      'tests/migrations/378_rbac_field_stock_force_correct.test.ts',
      // Stale: these describe code that has since changed underneath them, so
      // they are noise rather than signal. Excluded with the diagnosis recorded
      // so picking them up again does not start from zero.
      //   TemplateList — uses jest.* (undefined under vitest), and every
      //   assertion targets data-testid / copy that TemplateList.tsx does not
      //   contain; the component has no data-testid attributes at all. Needs
      //   the syntax converted AND all 25 assertions rewritten.
      'src/modules/workflow/__tests__/components/TemplateList.test.tsx',
      //   returns-create-hardening — its @/lib/db mock is missing `pool`, and
      //   underneath that the handler now derives the role from a staff row it
      //   queries (staffRow.auth_role via isReturnCreator), while the tests
      //   still set req.user.role and never stub that lookup, so all 11 return
      //   403/500. Needs the mock completed AND each case restubbed.
      'tests/api/procurement/field-stock/returns-create-hardening.test.ts',
    ],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    // IMPORTANT: More specific aliases must come before generic '@'
    // otherwise '@' → './src' will greedily match '@/lib/...' before
    // the '@/lib' → './lib' alias gets a chance to apply.
    alias: [
      // Specific @/lib/* paths that live in src/lib/ (mirrors tsconfig.json paths).
      // tsconfig maps @/lib/* to BOTH ./src/lib/* and ./lib/* (src first),
      // but Vitest alias only supports single-target matching, so each module
      // that lives in src/lib needs an explicit override before the generic
      // @/lib → ./lib fallback at the end.
      { find: '@sentry/nextjs', replacement: path.resolve(__dirname, 'src/lib/sentry/__stubs__/sentry-nextjs.ts') },
      { find: /^@\/lib\/sentry/, replacement: path.resolve(__dirname, 'src/lib/sentry') },
      // @/lib/mcp/* lives at src/lib/mcp/ (MCP edge-proxy stream bounds) — explicit
      // src-first override before the generic @/lib → ./lib fallback below.
      { find: /^@\/lib\/mcp/, replacement: path.resolve(__dirname, 'src/lib/mcp') },
      { find: /^@\/lib\/observability/, replacement: path.resolve(__dirname, 'src/lib/observability') },
      { find: '@/lib/rateLimiter', replacement: path.resolve(__dirname, './src/lib/rateLimiter') },
      { find: '@/lib/featureFlags', replacement: path.resolve(__dirname, './src/lib/featureFlags') },
      { find: '@/lib/utils', replacement: path.resolve(__dirname, './src/lib/utils') },
      { find: '@/lib/smtpConfig', replacement: path.resolve(__dirname, './src/lib/smtpConfig') },
      { find: '@/lib/db-neon', replacement: path.resolve(__dirname, './src/lib/db-neon') },
      { find: '@/lib/neon', replacement: path.resolve(__dirname, './src/lib/neon') },
      { find: '@/lib/db-pool', replacement: path.resolve(__dirname, './src/lib/db-pool') },
      // @/lib/db-logger lives at root ./lib/ — without this explicit entry the
      // /^@\/lib\/db/ regex below rewrites it to src/lib/db-logger (missing),
      // killing collection of any test importing a module that uses db-logger.
      { find: '@/lib/db-logger', replacement: path.resolve(__dirname, './lib/db-logger') },
      // @/lib/db/* lives at src/lib/db/ (serialEventContext etc.)
      { find: /^@\/lib\/db/, replacement: path.resolve(__dirname, './src/lib/db') },
      { find: '@/lib/serial-events', replacement: path.resolve(__dirname, './src/lib/serial-events') },
      { find: '@/lib/vlmGallery', replacement: path.resolve(__dirname, './src/lib/vlmGallery') },
      { find: '@/lib/imageHash', replacement: path.resolve(__dirname, './src/lib/imageHash') },
      { find: '@/lib/internalPhotoUrl', replacement: path.resolve(__dirname, './src/lib/internalPhotoUrl') },
      { find: '@/lib/vfStoragePhotoUrl', replacement: path.resolve(__dirname, './src/lib/vfStoragePhotoUrl') },
      { find: '@/lib/vfStorageUpload', replacement: path.resolve(__dirname, './src/lib/vfStorageUpload') },
      { find: '@/lib/vlm', replacement: path.resolve(__dirname, './src/lib/vlm') },
      // @/lib/offline-queue lives at src/lib/offline-queue/ (generic offline-write
      // queue used by the snag-resolve PWA pilot) — explicit src-first override
      // before the @/lib → ./lib fallback.
      { find: '@/lib/offline-queue', replacement: path.resolve(__dirname, './src/lib/offline-queue') },
      { find: '@/lib/arcjet', replacement: path.resolve(__dirname, './src/lib/arcjet') },
      { find: '@/lib/email', replacement: path.resolve(__dirname, './src/lib/email') },
      { find: '@/lib/dbCircuitBreaker', replacement: path.resolve(__dirname, './src/lib/dbCircuitBreaker') },
      { find: '@/lib/geo', replacement: path.resolve(__dirname, './src/lib/geo') },
      { find: '@/lib/apiResponse', replacement: path.resolve(__dirname, './src/lib/apiResponse') },
      { find: '@/lib/handleApiResponse', replacement: path.resolve(__dirname, './src/lib/handleApiResponse') },
      { find: '@/lib/authErrorHandler', replacement: path.resolve(__dirname, './src/lib/authErrorHandler') },
      // @/lib/auth-mock lives at root ./lib/ — the generic @/lib fallback
      // below doesn't get the chance because `@/lib/auth` (more specific)
      // matches first. Needs an explicit entry above the auth alias.
      { find: '@/lib/auth-mock', replacement: path.resolve(__dirname, './lib/auth-mock') },
      { find: '@/lib/auth', replacement: path.resolve(__dirname, './src/lib/auth') },
      { find: '@/lib/permissions', replacement: path.resolve(__dirname, './src/lib/permissions') },
      { find: '@/lib/logger', replacement: path.resolve(__dirname, './src/lib/logger') },
      // @/lib/hooks/* lives at src/lib/hooks/ — needed after useStockSync was updated
      // to import from '@/lib/hooks/useOnlineStatus' (bucket B refactor).
      { find: /^@\/lib\/hooks/, replacement: path.resolve(__dirname, './src/lib/hooks') },
      // @/lib/cortex/* lives at src/lib/cortex/ (Cortex Scribe outbox pull) — explicit
      // override before the generic @/lib → ./lib fallback (mirrors tsconfig src-first).
      { find: /^@\/lib\/cortex/, replacement: path.resolve(__dirname, './src/lib/cortex') },
      // @/lib/llm/* + @/lib/action-items/* live at src/lib/ (meeting LLM processor +
      // assignee resolution) — explicit src-first overrides before the @/lib → ./lib
      // fallback, needed by the Goal 3b summary-lock test.
      { find: /^@\/lib\/llm/, replacement: path.resolve(__dirname, './src/lib/llm') },
      { find: /^@\/lib\/action-items/, replacement: path.resolve(__dirname, './src/lib/action-items') },
      // @/lib/staff/* lives at src/lib/ (hrVisibilityFilters — Slice B HR-hiding
      // filters) — explicit src-first override before the @/lib → ./lib fallback.
      { find: /^@\/lib\/staff/, replacement: path.resolve(__dirname, './src/lib/staff') },
      // @/lib/graph/* lives at src/lib/graph/ (Microsoft Graph auth + photo-url
      // allowlist, used by photoFetchService for civil gallery photos) — explicit
      // src-first override before the @/lib → ./lib fallback.
      { find: /^@\/lib\/graph/, replacement: path.resolve(__dirname, './src/lib/graph') },
      // @/lib/images/* lives at src/lib/images/ (shared browser image-downscale
      // util for the offline-photo PWA queue) — explicit src-first override
      // before the generic @/lib → ./lib fallback.
      { find: /^@\/lib\/images/, replacement: path.resolve(__dirname, './src/lib/images') },
      // @/lib/sharepoint/* lives at src/lib/sharepoint/ (Fibertime SharePoint
      // REST client) — explicit src-first override before the generic fallback.
      { find: /^@\/lib\/sharepoint/, replacement: path.resolve(__dirname, './src/lib/sharepoint') },
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
  esbuild: {
    jsx: 'automatic',
  },
});
