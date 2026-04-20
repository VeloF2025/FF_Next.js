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
      // below doesn't get the chance because `@/lib/auth` (more specific)
      // matches first. Needs an explicit entry above the auth alias.
      { find: '@/lib/auth-mock', replacement: path.resolve(__dirname, './lib/auth-mock') },
      { find: '@/lib/auth', replacement: path.resolve(__dirname, './src/lib/auth') },
      { find: '@/lib/permissions', replacement: path.resolve(__dirname, './src/lib/permissions') },
      { find: '@/lib/logger', replacement: path.resolve(__dirname, './src/lib/logger') },
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
