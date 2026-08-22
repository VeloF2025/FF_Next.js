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
      // each throws at module load when TEST_DATABASE_URL is unset, before any
      // describe/it runs, and each constructs a real pg.Pool at module scope
      // (inside vi.hoisted in reports-scope and reports-scope-xlsx, as a plain
      // top-level const in the other four). Either way the pool is built before
      // any test executes, so they cannot be skipped gracefully.
      // Excluding them stops six files failing collection on every unit run;
      // set TEST_DATABASE_URL and target them directly to run them.
      'tests/routes/api/snags/reports-scope.test.ts',
      'tests/routes/api/snags/reports-scope-xlsx.test.ts',
      'tests/routes/api/snags/reports-source-filter.test.ts',
      'src/modules/construction-qa/services/reportNumberGenerator.test.ts',
      'tests/migrations/518_fleet_retention_holds.test.ts',
      'tests/migrations/521_fleet_retention_delete_grants.test.ts',
      'tests/migrations/518_fleet_retention_purge.test.ts',
      'tests/migrations/358_snag_reports_scope.test.ts',
      'tests/migrations/378_rbac_field_stock_force_correct.test.ts',
      'tests/migrations/471_hs_training_certificate_upload.test.ts',
      'tests/migrations/472_works_qa_pole_planning_view.test.ts',
      'tests/migrations/473_backfill_unified_reviews_project.test.ts',
      'tests/migrations/503_backfill_unified_reviews_from_whatsapp.test.ts',
      'tests/migrations/474_metrics_snapshot_spine.test.ts',
      'tests/migrations/475_attendance_policy_workflow.test.ts',
      'tests/migrations/476_attendance_lock_hr_authority.test.ts',
      'tests/migrations/477_conformed_project_dimension.test.ts',
      'tests/migrations/479_attendance_tracked_opt_in.test.ts',
      'tests/migrations/479_ticket_gps_oes_backfill.test.ts',
      'tests/migrations/480_pole_plan_replan_backup.test.ts',
      'tests/migrations/481_pole_qa_photo_superseded.test.ts',
      'tests/migrations/482_attendance_adjustment_time_order.test.ts',
      'tests/migrations/483_fleet_parking_compliance.test.ts',
      'tests/migrations/483_fleet_parking_queries.test.ts',
      'tests/migrations/483_fleet_parking_driver_queries.test.ts',
      'tests/migrations/483_fleet_parking_approval.test.ts',
      'tests/migrations/484_attendance_historical_schedule_policy.test.ts',
      'tests/migrations/484_attendance_historical_schedule_policy_rollback.test.ts',
      'tests/migrations/485_fleet_parking_approver_narrowing.test.ts',
      'tests/migrations/487_hs_attachments.test.ts',
      'tests/migrations/488_hs_training_types_additional_competencies.test.ts',
      'tests/migrations/489_hs_ppe_acknowledgements.test.ts',
      'tests/migrations/490_wiekus_health_safety_edit.test.ts',
      'tests/migrations/496_fleet_parking_operational_foundations.test.ts',
      'tests/migrations/497_fleet_operational_assignments.test.ts',
      'tests/migrations/498_fleet_operational_evidence.test.ts',
      'tests/migrations/498_fleet_operational_status_rules.test.ts',
      'tests/migrations/498_fleet_status_geometry.test.ts',
      'tests/migrations/499_attendance_project_aois.test.ts',
      'tests/migrations/500_attendance_exception_kinds.test.ts',
      'tests/migrations/501_attendance_clock_out_aoi.test.ts',
      'tests/migrations/510_fleet_operational_incidents.test.ts',
      'tests/migrations/511_fleet_incident_driver_input.test.ts',
      'tests/migrations/512_fleet_assignment_roster_sql.test.ts',
      'tests/migrations/513_fleet_assignment_preview_state.test.ts',
      'tests/migrations/518_fleet_operational_analytics_retention.test.ts',
      'tests/migrations/522_fleet_site_inference.test.ts',
      'tests/migrations/522_fleet_site_inference_dwell.test.ts',
      'tests/migrations/523_project_aoi_outlier_guard.test.ts',
      'tests/migrations/523_project_aoi_staleness_probe.test.ts',
      'tests/migrations/metric-registry-execution.test.ts',
      // Not runnable as written. Excluded with the diagnosis recorded so that
      // picking them up does not start from zero.
      //
      //   TemplateList — written for jest, which is not a dependency of this
      //   repo at all (no `jest` in package.json, no jest.config anywhere; only
      //   jest-axe). So this was likely never runnable under any runner wired
      //   into this project, rather than having gone stale after a refactor.
      //   Beyond the syntax, the file contradicts the component wholesale:
      //   TemplateList.tsx has zero data-testid attributes, exposes only
      //   onTemplateSelect / onTemplateEdit / selectedTemplateId, has no
      //   category/status/sort dropdowns, no "No workflow templates found"
      //   copy, no "Create New Template" button, and uses confirm() rather than
      //   a delete modal. 31 it() blocks and 69 expect() calls, nearly all
      //   asserting against UI that does not exist. Needs a rewrite, not a fix.
      'src/modules/workflow/__tests__/components/TemplateList.test.tsx',
      //   ContractorImport — two real bugs fixed in place (a document.createElement
      //   spy that recursed into itself and blew the stack on every render, and
      //   the modal's required isOpen/onClose props which were never passed, so
      //   the component returned null and rendered an empty <div />). With both
      //   fixed it renders correctly, but all 18 assertions still target a
      //   richer earlier UI the current 5.8KB modal does not have: a
      //   "choose contractor file" label, "Export All Contractors",
      //   "Download Template", an instructions panel, a drop-zone caption.
      //   One assertion rewrite away from working; the fixes are kept so that
      //   rewrite does not start by re-diagnosing a stack overflow.
      'src/components/contractor/ContractorImport.test.tsx',
      //
      //   returns-create-hardening — three layers, and the first is what
      //   actually breaks it:
      //     1. _create.ts calls the real promoteSerial(txn.client, …) inside
      //        transaction(). The test's txn stub has no `client`, so it throws
      //        on client.query('BEGIN') and the first case 500s.
      //     2. That case consumes only 2 of its 5 queued mockResolvedValueOnce
      //        values. vi.clearAllMocks() clears call history but NOT queued
      //        one-shot return values, so the 3 leftovers bleed into the next
      //        test, corrupt its staffRow, and cascade as 403s through the rest
      //        of the file.
      //     3. Its @/lib/db mock is also missing `pool` — a traceable
      //        regression: a8794e967 removed pool/default as "false signal"
      //        when the handler only imported sql, then 713195767 added
      //        transaction() to _create.ts without updating the mock.
      //   The staff-row lookup IS stubbed correctly; the 403s are downstream of
      //   (1) and (2), not a role-derivation bug. Needs promoteSerial mocked or
      //   the txn stub given a client, plus per-test stub queues that cannot
      //   bleed.
      'tests/api/procurement/field-stock/returns-create-hardening.test.ts',
      // Integration test against the live shared DB (its own header says so):
      // it default-imports `pool` from '@/lib/db' and issues real queries inside
      // transactions it always ROLLBACKs. vitest.setup.ts globally mocks
      // '@/lib/db' with stubs and no default export, so under the unit config
      // the import is undefined before a single query runs — it cannot pass here
      // by construction, regardless of the data. Run it directly when needed.
      'tests/api/activate/pp-data-gps-backfill.test.ts',
      // Same class, found 2026-08-01: this fires real HTTP at
      // `process.env.VITE_API_URL || 'http://localhost:3000/api'`. On this host
      // port 3000 is fibreflow-production.service — so these "unit tests" have
      // been passing by making live requests against PRODUCTION, and they fail
      // anywhere that cannot reach it. That is why they were green on the old
      // CI runner (ran as `hein`, shared host network) and go red on the
      // isolated runner, which is the one behaving correctly.
      //
      // Excluded rather than allowlisted: scripts/known-test-failures.txt says
      // in its own header never to add a line to turn a red build green, and
      // that is the right call here — the failure is real, the test is wrong.
      // To reinstate, point it at a server the test itself starts, or move it
      // to a smoke-test job that is explicitly allowed to talk to a deployed
      // environment.
      'src/tests/api-integration/api-health.test.ts',
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
      // @/lib/wa-bridge-health/* lives at src/lib/ — without this it falls through
      // to the generic @/lib → ./lib fallback and fails to resolve under Vitest.
      { find: /^@\/lib\/wa-bridge-health/, replacement: path.resolve(__dirname, 'src/lib/wa-bridge-health') },
      // @/lib/vlm-health/* lives at src/lib/ — without this it falls through
      // to the generic @/lib → ./lib fallback and fails to resolve under Vitest.
      { find: /^@\/lib\/vlm-health/, replacement: path.resolve(__dirname, 'src/lib/vlm-health') },
      // @/lib/cronAuth lives at src/lib/ — without this it falls through to the generic
      // @/lib -> ./lib fallback below and fails to resolve under Vitest.
      { find: '@/lib/cronAuth', replacement: path.resolve(__dirname, './src/lib/cronAuth') },
      { find: '@/lib/rateLimiter', replacement: path.resolve(__dirname, './src/lib/rateLimiter') },
      { find: '@/lib/featureFlags', replacement: path.resolve(__dirname, './src/lib/featureFlags') },
      { find: '@/lib/actionItems', replacement: path.resolve(__dirname, './src/lib/actionItems') },
      { find: '@/lib/utils', replacement: path.resolve(__dirname, './src/lib/utils') },
      { find: '@/lib/smtpConfig', replacement: path.resolve(__dirname, './src/lib/smtpConfig') },
      { find: '@/lib/db-neon', replacement: path.resolve(__dirname, './src/lib/db-neon') },
      { find: '@/lib/neon', replacement: path.resolve(__dirname, './src/lib/neon') },
      { find: '@/lib/neon-sql', replacement: path.resolve(__dirname, './src/lib/neon-sql') },
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
      // @/lib/photos/* lives at src/lib/photos/ — without this it falls through to the
      // generic @/lib → ./lib fallback below and fails to resolve under Vitest.
      { find: '@/lib/photos', replacement: path.resolve(__dirname, './src/lib/photos') },
      // @/lib/reporting/* lives at src/lib/reporting/ — without this it falls through to
      // the generic @/lib → ./lib fallback below and fails to resolve under Vitest.
      { find: '@/lib/meetings', replacement: path.resolve(__dirname, './src/lib/meetings') },
      { find: '@/lib/reporting', replacement: path.resolve(__dirname, './src/lib/reporting') },
      // @/lib/offline-queue lives at src/lib/offline-queue/ (generic offline-write
      // queue used by the snag-resolve PWA pilot) — explicit src-first override
      // before the @/lib → ./lib fallback.
      { find: '@/lib/offline-queue', replacement: path.resolve(__dirname, './src/lib/offline-queue') },
      { find: '@/lib/arcjet', replacement: path.resolve(__dirname, './src/lib/arcjet') },
      { find: '@/lib/email', replacement: path.resolve(__dirname, './src/lib/email') },
      { find: '@/lib/dbCircuitBreaker', replacement: path.resolve(__dirname, './src/lib/dbCircuitBreaker') },
      { find: '@/lib/geo', replacement: path.resolve(__dirname, './src/lib/geo') },
      { find: '@/lib/security', replacement: path.resolve(__dirname, './src/lib/security') },
      { find: '@/lib/apiResponse', replacement: path.resolve(__dirname, './src/lib/apiResponse') },
      { find: '@/lib/saIdValidation', replacement: path.resolve(__dirname, './src/lib/saIdValidation') },
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
