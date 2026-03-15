# FibreFlow Optimization TODO Plan

**Created:** 2026-03-15
**Baseline:** `auto-research/baseline-2026-03-15.md`
**Rule:** Every change goes through a PR. No direct master commits. Test before merging.

---

## Phase 1: Security Fixes (CRITICAL — do first)

### 1.1 Hardcoded isApprover bypass
- [ ] **File:** `pages/procurement/requisitions/[id].tsx:141`
- [ ] **Issue:** `const isApprover = true; // TODO: Check user permissions`
- [ ] **Fix:** Replace with actual RBAC permission check using `usePermissions()` or API-side auth
- [ ] **Test:** Verify non-approver users cannot approve requisitions
- [ ] **PR branch:** `fix/requisition-approver-rbac`

### 1.2 Math.random() VLM fallback
- [ ] **File:** `src/modules/activate/services/unifiedVlmService.ts:186-194`
- [ ] **Issue:** On VLM API failure, returns `Math.random()` scores with `passed: Math.random() > 0.3`
- [ ] **Fix:** Return error/failed status instead of fabricated scores. Log the failure.
- [ ] **Pre-check:** Verify if this service is still called anywhere (may be deprecated)
- [ ] **Test:** Simulate VLM failure, confirm no fake scores returned
- [ ] **PR branch:** `fix/vlm-random-fallback`

### 1.3 RBAC bypass in ProtectedRoute
- [ ] **File:** `src/components/auth/ProtectedRoute.tsx:28,108`
- [ ] **Issue:** `// TODO: Remove this bypass when implementing RBAC` — bypass still active
- [ ] **Fix:** Implement actual permission check or remove bypass
- [ ] **Pre-check:** Audit which routes depend on this component — broad blast radius
- [ ] **Test:** Verify protected routes still load for authorized users, block unauthorized
- [ ] **PR branch:** `fix/protected-route-rbac`

---

## Phase 2: Zero-Risk Quick Wins (no code logic changes)

### 2.1 Remove unused packages
- [ ] **Verify** `@zxing/library` has zero imports: `grep -r "@zxing/library" src/ pages/ --include="*.ts" --include="*.tsx"`
- [ ] **Verify** `recharts` has zero imports: `grep -r "from 'recharts'" src/ pages/ --include="*.ts" --include="*.tsx"`
- [ ] **Verify** `html5-qrcode` has zero imports (same grep)
- [ ] **Verify** `@ericblade/quagga2` has zero imports (same grep)
- [ ] Run `npm uninstall @zxing/library recharts` (only confirmed ones)
- [ ] Run `npm run build` — confirm build still succeeds
- [ ] **PR branch:** `chore/remove-unused-deps`

### 2.2 Add MUI to optimizePackageImports
- [ ] **File:** `next.config.js` → `experimental.optimizePackageImports` array
- [ ] **Add:** `'@mui/material'`, `'@mui/icons-material'`, `'@mui/x-data-grid'`
- [ ] Run `npm run build` — confirm no regressions
- [ ] Compare bundle sizes before/after (check `/kpi-dashboard`, `/wa-monitor` pages)
- [ ] **PR branch:** `chore/optimize-mui-imports`

### 2.3 Fix ESLint plugin
- [ ] Run `npm install eslint-plugin-local@latest --save-dev`
- [ ] Run `npm run lint` — check if it passes now
- [ ] Fix any lint errors surfaced (or document them)
- [ ] **PR branch:** `fix/eslint-plugin-local`

### 2.4 Exclude pdfcraft from tsconfig
- [ ] **File:** `tsconfig.json`
- [ ] **Add** `"tools/pdfcraft"` to `exclude` array
- [ ] Run `npx tsc --noEmit 2>&1 | grep "error TS" | wc -l` — expect ~1,140 (down from 6,140)
- [ ] Run `npm run build` — confirm pdfcraft exclusion doesn't break build
- [ ] **PR branch:** `chore/exclude-pdfcraft-tsconfig`

### 2.5 Fix case conflict warning
- [ ] **Files:** `src/modules/stock-items/components/CheckOutModal.tsx` vs `CheckoutModal.tsx`
- [ ] **Fix:** Rename to consistent casing (pick one) and update imports
- [ ] Run `npm run build` — confirm warning gone
- [ ] **PR branch:** `fix/checkout-modal-casing`

---

## Phase 3: Performance — Sequential Awaits → Promise.all

### 3.1 Maturity tracking API
- [ ] **File:** `pages/api/activate/reporting/maturity-tracking.ts`
- [ ] **Lines:** 110, 145, 205, 230 — 4 independent queries run sequentially
- [ ] **Fix:** Wrap in `const [poScope, project, milestone, velocity] = await Promise.all([...])`
- [ ] **Test:** Compare response body before/after (must be identical)
- [ ] **Measure:** Response time before vs after
- [ ] **PR branch:** `perf/maturity-tracking-parallel`

### 3.2 Technician performance API
- [ ] **File:** `pages/api/technicians/[id]/performance.ts`
- [ ] **Lines:** 118, 155, 180, 207 — 4 independent queries
- [ ] **Fix:** `Promise.all([summaryQuery, trendQuery, projectQuery, recentDRsQuery])`
- [ ] **Test:** Compare response body before/after
- [ ] **Measure:** Response time before vs after
- [ ] **PR branch:** `perf/technician-perf-parallel`

### 3.3 Fuel transactions API
- [ ] **File:** `pages/api/fleet/vehicles/[id]/fuel-transactions.ts`
- [ ] **Lines:** 177, 185, 191 — 3 independent queries (rows, count, stats)
- [ ] **Fix:** `Promise.all([rowsQuery, countQuery, statsQuery])`
- [ ] **Test:** Compare response body before/after
- [ ] **Measure:** Response time before vs after
- [ ] **PR branch:** `perf/fuel-transactions-parallel`

---

## Phase 4: Performance — N+1 Query Fixes

### 4.1 Meeting sync N+1
- [ ] **File:** `pages/api/meetings/sync-teams.ts:80-92`
- [ ] **Issue:** `for (record of records) { await sql }` — per-record DB check
- [ ] **Fix:** Batch lookup — fetch all existing meeting IDs first, then filter in JS
- [ ] **Test:** Sync result must be identical
- [ ] **PR branch:** `perf/meetings-sync-batch`

### 4.2 NOC verification N+1
- [ ] **File:** `pages/api/noc/verification.ts:51-56`
- [ ] **Issue:** `for (template of templates) { await sql INSERT }` — per-step insert
- [ ] **Fix:** Single bulk `INSERT INTO ... VALUES (...), (...), (...)` or `INSERT ... SELECT`
- [ ] **Test:** Verify all steps still created correctly
- [ ] **PR branch:** `perf/noc-verification-bulk-insert`

### 4.3 Roles permissions N+1
- [ ] **File:** `pages/api/admin/roles/index.ts:57`
- [ ] **Issue:** `.map(async (role) => getRolePermissions(role.name))` — N queries for N roles
- [ ] **Fix:** Single query fetching all role permissions, group client-side
- [ ] **Test:** Response body must match original
- [ ] **PR branch:** `perf/roles-permissions-batch`

### 4.4 Disciplinary incidents N+1
- [ ] **File:** `pages/api/staff/[staffId]/disciplinary.ts:45-46`
- [ ] **Issue:** `.map(async (incident) => ...)` per incident
- [ ] **Fix:** Batch query with `WHERE id = ANY($1)` for all incident IDs at once
- [ ] **Test:** Response body must match original
- [ ] **PR branch:** `perf/disciplinary-batch`

---

## Phase 5: Bundle Size — Dynamic Imports

### 5.1 Dynamic import jspdf
- [ ] **Files:** `src/modules/*/utils/exportUtils.ts`, `src/modules/accounting/utils/reconReportPdf.ts`, `src/modules/accounting/utils/statementPdf.ts`
- [ ] **Fix:** Change `import jsPDF from 'jspdf'` to `const { jsPDF } = await import('jspdf')` inside handler function
- [ ] **Test:** Export/PDF generation still works
- [ ] **Measure:** Check if affected pages shrink in First Load JS
- [ ] **PR branch:** `perf/dynamic-import-jspdf`

### 5.2 Server-only guard for xlsx
- [ ] **Check:** Which client-side components import xlsx directly?
  - `src/modules/noc/components/ThreeWayAlignmentReport.tsx`
  - `pages/procurement/boq/[id].tsx`
- [ ] **Fix:** Move xlsx processing to API route, call from client via fetch
- [ ] **Alt:** Use dynamic `import('xlsx')` inside click handler
- [ ] **Test:** Excel export still works from UI
- [ ] **PR branch:** `perf/xlsx-server-only`

### 5.3 Lazy load heavy MUI pages
- [ ] **Identify:** 10 files importing MUI (SOW datagrid, WA monitor, reconciliation)
- [ ] **Fix:** Wrap MUI-using components with `lazyLoad()` or `next/dynamic`
- [ ] **Test:** Pages still render correctly
- [ ] **Measure:** First Load JS reduction on affected pages
- [ ] **PR branch:** `perf/lazy-load-mui`

---

## Phase 6: SQL Query Optimization

### 6.1 Trend analysis caching
- [ ] **File:** `src/modules/activate/services/reporting/trendAnalysisService.ts`
- [ ] **Issue:** 2 complex queries with CTEs + generate_series, no caching
- [ ] **Fix:** Add `queryCache` with 5-min TTL keyed by date range + project filter
- [ ] **Test:** First call populates cache, second call returns cached data, cache expires correctly
- [ ] **PR branch:** `perf/trend-analysis-cache`

### 6.2 Team performance parallelization
- [ ] **File:** `src/modules/activate/services/reporting/teamPerformanceService.ts`
- [ ] **Issue:** 5 sequential pool queries
- [ ] **Fix:** `Promise.all([leaderboard, installerLeaderboard, teamComparison, compliance, waCompliance])`
- [ ] **Test:** Response body identical
- [ ] **Measure:** Response time before vs after
- [ ] **PR branch:** `perf/team-performance-parallel`

### 6.3 Drops endpoint — stop fetching JSONB blobs
- [ ] **File:** `pages/api/activate/drops.ts`
- [ ] **Issue:** `SELECT u.*` pulls `photos_metadata`, `vlm_categorization_results`, `submission_history` JSONB columns
- [ ] **Fix:** Replace `u.*` with specific column list (exclude large JSONB unless needed by caller)
- [ ] **Pre-check:** Verify frontend doesn't use those JSONB fields on the list page
- [ ] **Test:** UI still displays correctly
- [ ] **Measure:** Response payload size before vs after
- [ ] **PR branch:** `perf/drops-select-specific-columns`

### 6.4 BOQ spend summary correlated subqueries
- [ ] **File:** `pages/api/procurement/boq-spend-summary.ts`
- [ ] **Issue:** 4 correlated subqueries per project row — O(N×4) scans
- [ ] **Fix:** Rewrite as JOINs with pre-aggregated CTEs
- [ ] **Test:** Response data must match original exactly
- [ ] **Measure:** EXPLAIN ANALYZE timing before vs after
- [ ] **PR branch:** `perf/boq-spend-summary-rewrite`

### 6.5 Stock items 14× SELECT *
- [ ] **File:** `pages/api/stock-items/index.ts`
- [ ] **Issue:** 14 separate `SELECT *` queries across filter branches
- [ ] **Fix:** Consolidate to single query with dynamic WHERE conditions (NOT conditional SQL fragments — use explicit branches or query builder)
- [ ] **Test:** All filter combinations return same data
- [ ] **PR branch:** `perf/stock-items-query-consolidation`

### 6.6 Staff list missing pagination
- [ ] **File:** `pages/api/staff/index.ts:127-313`
- [ ] **Issue:** No LIMIT on 12+ filter branches — returns all staff
- [ ] **Fix:** Add pagination params (page, pageSize) with default LIMIT 50
- [ ] **Pre-check:** Verify frontend handles paginated response (or add pagination to frontend)
- [ ] **Test:** Frontend still displays staff list correctly
- [ ] **PR branch:** `perf/staff-list-pagination`

---

## Phase 7: VLM Prompt Improvements

### 7.1 Wire HITL few-shot to missing prompts
- [ ] **License plate** (`fleetVlmService.ts:240`) — add `getRelevantExamples('license_plate')` injection
- [ ] **Fuel gauge** (`fleetVlmService.ts:264`) — add few-shot injection
- [ ] **Fuel receipt** (`fleetVlmService.ts:292`) — add few-shot injection
- [ ] **License disk** (`fleetVlmService.ts:333`) — add few-shot injection
- [ ] **QA validation** (`vlmQaValidationService.ts:249`) — add few-shot injection
- [ ] **Asset label** (`assetVlmService.ts:71`) — add few-shot injection
- [ ] **Field ops** (`fieldOpsVlmService.ts:59`) — add few-shot injection
- [ ] **Test:** Prompts still work without corrections in DB (graceful fallback)
- [ ] **PR branch:** `feat/vlm-hitl-all-prompts`

### 7.2 Wire metrics recording to missing prompts
- [ ] **License plate** — add `recordCorrectExtraction` / `recordVlmCorrection` calls
- [ ] **Fuel gauge** — same
- [ ] **Fuel receipt** — same
- [ ] **License disk** — same
- [ ] **QA validation** — same
- [ ] **Field ops civil/optical** — same
- [ ] **Test:** `vlm_metrics` table gets populated for new analysis types
- [ ] **PR branch:** `feat/vlm-metrics-all-prompts`

### 7.3 Fix power meter range inconsistency
- [ ] **Extraction prompt** (`vlmExtractionService.ts:148`): says `-5 to -35 dBm`
- [ ] **QA validation** (`vlmQaValidationService.ts` step 7.2): says `-8 to -28 dBm`
- [ ] **Fix:** Align to single authoritative range (check with Hein which is correct)
- [ ] **PR branch:** `fix/vlm-power-meter-range`

### 7.4 Add negative sign reminder to power meter prompt
- [ ] **File:** `vlmExtractionService.ts:148`
- [ ] **Add:** "Power meter readings are ALWAYS negative (e.g., -22.4 dBm, NOT 22.4). Always include the minus sign."
- [ ] **Test:** Run against 10 sample photos, verify sign is correct
- [ ] **PR branch:** `fix/vlm-power-meter-negative-sign`

### 7.5 Strengthen license plate prompt
- [ ] **File:** `fleetVlmService.ts:240`
- [ ] **Current:** Only 78 tokens, 4 rules — critically thin
- [ ] **Add:** SA plate format patterns (CA 123-456, GP ABC 12, custom, temporary TRN plates), dirty/partial plate instructions, per-character confidence
- [ ] **Auto-research candidate:** `/auto-research license-plate --mode vlm --runs 10 --batch 20`
- [ ] **PR branch:** `feat/vlm-license-plate-improve`

### 7.6 Fix unified VLM deprecated service
- [ ] **File:** `src/modules/activate/services/unifiedVlmService.ts`
- [ ] **Check:** Is this service still imported/called anywhere?
  - `grep -r "unifiedVlmService\|unifiedPhotoService\|buildStepPrompt" src/ pages/ --include="*.ts" --include="*.tsx"`
- [ ] **If unused:** Delete the file
- [ ] **If used:** Remove Math.random() fallback, fix step numbering to match other services
- [ ] **PR branch:** `fix/unified-vlm-cleanup`

### 7.7 ONT serial statistical bias
- [ ] **File:** `vlmExtractionService.ts:173`
- [ ] **Issue:** "7th char is '8' (64%), '7' (26%), '6' (10%)" — may bias VLM toward '8'
- [ ] **Auto-research candidate:** Test with and without distribution hints, measure accuracy delta
- [ ] `/auto-research ont-serial --mode vlm --runs 5 --batch 20`
- [ ] **PR branch:** `experiment/vlm-serial-bias-test`

---

## Phase 8: Code Quality — Conditional SQL Fixes

### 8.1 Fix 21 files with conditional SQL fragments
Each file uses the `${cond ? sql\`AND x\` : sql\`\`}` anti-pattern that breaks Neon.

- [ ] `pages/api/contractors-documents.ts:48-49`
- [ ] `pages/api/projects/[projectId]/customer-invoices/generate.ts:55-57,172`
- [ ] `pages/api/projects/[projectId]/customer-invoices/index.ts:48-49,58-59`
- [ ] `pages/api/projects/[projectId]/drops/uninvoiced.ts`
- [ ] `pages/api/activate/serial-history.ts`
- [ ] Plus ~16 more in health-safety, construction-qa, pipeline APIs
- [ ] **Fix pattern:** Replace with explicit query branches:
  ```typescript
  // BEFORE (broken):
  const result = await sql`SELECT * FROM t WHERE 1=1 ${cond ? sql`AND x = ${v}` : sql``}`

  // AFTER (correct):
  const result = cond
    ? await sql`SELECT * FROM t WHERE x = ${v}`
    : await sql`SELECT * FROM t`
  ```
- [ ] **Test:** Each fixed endpoint returns same data as before
- [ ] **PR branch:** `fix/conditional-sql-fragments` (can batch multiple files per PR)

---

## Phase 9: Code Quality — File Size Reduction

### 9.1 Split oversized API routes (> 600 lines)

| File | Lines | Split Strategy |
|------|-------|----------------|
| `activate/import-oes.ts` | 1,283 | Extract validation, parsing, DB operations into service |
| `activate/process-new-dr.ts` | 1,038 | Extract WA processing, VLM calls, photo handling into services |
| `documents-ocr-preview.ts` | 993 | Extract OCR logic into ocrService |
| `activate/drops.ts` | 968 | Extract query builders, formatters into dropsService |
| `activate/dr-acknowledgment.ts` | 930 | Extract message building, WA calls into ackService |
| `activate/pp-data-resolve.ts` | 838 | Extract resolution logic into ppDataService |
| `staff/index.ts` | 826 | Extract filter queries into staffQueryService |
| `activate/import-offline.ts` | 803 | Extract parsing into offlineImportService |
| `activate/send-feedback.ts` | 766 | Extract WA message building into feedbackService |
| `staff-documents-upload.ts` | 742 | Extract upload handling into documentUploadService |
| `fleet/vehicles/[id]/fuel-transactions.ts` | 741 | Extract fuel logic into fuelService |
| `activate/reporting/maturity-tracking.ts` | 718 | Extract queries into maturityService |
| `fleet/vehicles.ts` | 708 | Extract vehicle CRUD into vehicleService |
| `staff-documents/[documentId]/verify.ts` | 618 | Extract verification logic into verifyService |
| `procurement/purchase-orders/[id].ts` | 606 | Extract PO operations into poService |

- [ ] **Approach:** Extract business logic into `src/services/` or `src/modules/*/services/`, keep API route as thin handler
- [ ] **Test:** Each refactored endpoint returns identical responses
- [ ] **PR branches:** One per file or group of related files

### 9.2 Split oversized service files (> 500 lines)

| File | Lines | Split Strategy |
|------|-------|----------------|
| `noc/services/fibertimeQContactClient.ts` | 1,235 | Split by domain: ticket ops, sync ops, search ops |
| `noc/services/ticketService.ts` | 842 | Split: CRUD, assignment, status transitions |
| `noc/services/weeklyReportService.ts` | 824 | Split: data gathering, report formatting, export |
| `noc/services/handoverService.ts` | 767 | Split: handover creation, review, assignment |
| `procurement/reports/procurementReportsService.ts` | 584 | Split by report type |
| `noc/services/dashboardService.ts` | 577 | Split: metrics, widgets, aggregation |
| `noc/services/escalationService.ts` | 575 | Split: escalation rules, notifications, tracking |

- [ ] **PR branches:** One per service file

---

## Phase 10: Code Quality — Type Safety

### 10.1 Fix top TS error files in main app
- [ ] `pages/api/activate/import-oes.ts` — 60 errors
- [ ] `src/modules/fleet/services/fleetVlmService.ts` — 59 errors
- [ ] `src/modules/system/services/incidentLearning.ts` — 52 errors
- [ ] `pages/api/onemap/upload.ts` — 45 errors
- [ ] `neon/api/server.ts` — 44 errors
- [ ] `src/modules/wa-monitor/services/statsService.ts` — 40 errors
- [ ] **PR branch:** `fix/typescript-errors-batch-N` (batch by module)

### 10.2 Reduce `: any` usage (long-term, incremental)
- [ ] Priority targets: catch blocks (`error: any` → `error: unknown`), service params, transformers
- [ ] **Not a single PR** — fix as you touch files for other work
- [ ] Track progress: `grep -rn ": any" src/ pages/ --include="*.ts" --include="*.tsx" | wc -l` (current: 642 files)

---

## Phase 11: Dependency Cleanup

### 11.1 Remove react-router-dom dead code
- [ ] **Pre-check:** Audit `src/app/router/` directory — is it used in production?
- [ ] **Pre-check:** Check 52 importing files — are they legacy SPA files?
- [ ] **If confirmed dead:** Remove `src/app/router/` directory and clean imports
- [ ] Run `npm uninstall react-router-dom @types/react-router-dom` (if fully removed)
- [ ] Run `npm run build` — confirm no breakage
- [ ] **PR branch:** `chore/remove-react-router-dom`

### 11.2 Move pdf-lib to dependencies
- [ ] **File:** `package.json`
- [ ] **Issue:** `pdf-lib` is in `devDependencies` but used in production code (`reconReportPdf.ts`, `statementPdf.ts`)
- [ ] **Fix:** `npm install pdf-lib` (moves from dev to prod deps)
- [ ] **PR branch:** `chore/pdf-lib-dependency`

### 11.3 Consolidate xlsx + exceljs
- [ ] **Audit:** Which files use `exceljs` vs `xlsx`?
- [ ] **Decision:** Pick one library, migrate the other's usage
- [ ] **Fix `import * as XLSX`:** Change to named imports for tree-shaking: `import { read, utils, write } from 'xlsx'`
- [ ] **Long-term:** Consider `xlsx` (lighter) since most usage is simple read/write
- [ ] **PR branch:** `chore/consolidate-excel-libs`

---

## Phase 12: API Response Standardization

### 12.1 Migrate raw res.json to apiResponse
- [ ] **Current:** 321 files use raw `res.json()` / `res.status()`
- [ ] **Pattern:** Replace with `apiResponse.success(res, data)`, `apiResponse.error(res, ...)`, etc.
- [ ] **Caution:** Watch for double-wrapping anti-pattern (see MEMORY.md)
- [ ] **Approach:** Batch by module — accounting first, then procurement, then activate, etc.
- [ ] **Test:** Frontend still receives expected response shape
- [ ] **PR branches:** `refactor/api-response-<module>`

---

## Phase 13: Caching Layer

### 13.1 Add queryCache to reporting endpoints
- [ ] Trend analysis service — 5 min TTL
- [ ] Team performance service — 5 min TTL
- [ ] BOQ lifecycle — 5 min TTL
- [ ] Procurement aggregate metrics — 5 min TTL
- [ ] BOQ spend summary — 5 min TTL
- [ ] **Pattern:** Use existing `queryCache` from `src/lib/queryCache.ts`
- [ ] **Cache key:** Include all query params (date range, project filter, user filter)
- [ ] **Test:** First request populates cache, subsequent requests are faster
- [ ] **PR branch:** `perf/reporting-query-cache`

### 13.2 Add Cache-Control headers to stable endpoints
- [ ] `/api/analytics/dashboard/stats.ts` — `stale-while-revalidate=30`
- [ ] `/api/help-center/manual.ts` — already has `max-age=3600` (good)
- [ ] Identify other low-frequency-change endpoints
- [ ] **PR branch:** `perf/api-cache-headers`

---

## Phase 14: console.log Cleanup

### 14.1 Replace console.log in production modules
- [ ] `src/modules/noc/hooks/useVerification.ts`
- [ ] `src/modules/photo-review/utils/drValidator.ts`
- [ ] `src/modules/activate/services/unifiedPhotoService.ts`
- [ ] `src/modules/workflow/services/WorkflowManagementService.ts` (19 occurrences)
- [ ] **Fix:** Replace with `import { log } from '@/lib/logger'`
- [ ] **PR branch:** `fix/console-log-cleanup`

---

## Phase 15: Auto-Research Candidates (run after manual fixes)

These are the items best suited for iterative `/auto-research` optimization:

| # | Target | Command | Priority |
|---|--------|---------|----------|
| 15.1 | License plate prompt | `/auto-research license-plate --mode vlm --runs 10 --batch 20` | HIGH |
| 15.2 | Fuel gauge prompt | `/auto-research fuel-gauge --mode vlm --runs 5 --batch 10` | MEDIUM |
| 15.3 | Fuel receipt prompt | `/auto-research fuel-receipt --mode vlm --runs 5 --batch 10` | MEDIUM |
| 15.4 | QA validation prompts | `/auto-research qa-validation --mode vlm --runs 10 --batch 10` | HIGH |
| 15.5 | Photo categorization | `/auto-research dr-categorization --mode vlm --runs 10 --batch 20` | MEDIUM |
| 15.6 | ONT serial (bias test) | `/auto-research ont-serial --mode vlm --runs 5 --batch 20` | LOW |
| 15.7 | Trend analysis query | `/auto-research activate-stats --mode sql --runs 5` | MEDIUM |
| 15.8 | KPI dashboard page | `/auto-research /kpi-dashboard --mode lighthouse --runs 3` | MEDIUM |
| 15.9 | Main dashboard page | `/auto-research /dashboard --mode lighthouse --runs 3` | MEDIUM |
| 15.10 | Overall bundle | `/auto-research bundle --mode bundle --runs 3` | LOW |

---

## Execution Order (recommended)

```
Week 1: Phase 1 (security) + Phase 2 (zero-risk quick wins)
Week 2: Phase 3 (Promise.all) + Phase 4 (N+1 fixes)
Week 3: Phase 5 (dynamic imports) + Phase 8 (conditional SQL)
Week 4: Phase 7.1-7.4 (VLM HITL wiring + range fix)
Week 5: Phase 6 (SQL optimization) + Phase 13 (caching)
Week 6: Phase 9 (file splitting — start with worst offenders)
Week 7: Phase 15 (auto-research runs on VLM prompts)
Ongoing: Phase 10 (TS errors), Phase 11 (deps), Phase 12 (apiResponse), Phase 14 (console.log)
```

---

## Tracking

After each PR is merged, update this file:
- Change `[ ]` to `[x]`
- Add PR number: `[x] Fixed — PR #NNN`
- Add date completed
- Run baseline measurement again to track improvement

**Next baseline scan:** After Phase 1-4 complete, re-run all 7 agents to measure delta.
