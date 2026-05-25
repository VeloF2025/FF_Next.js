# Field-Stock Dashboard v2 — Design Spec

**Date:** 2026-05-25
**PR:** Wave 2 PR-10
**Branch:** `feat/wave2-pr10-dashboard-v2`
**Author:** Claude (brainstormed with Hein)

## Goal

Ship a new analytics dashboard for the Field-Stock module that adds four metric
groups the current dashboard lacks, in a modern layout, with drill-down links
into the existing serial/accountability surfaces. Shipped as a **new parallel
route** — the existing dashboard stays untouched (augment-not-replace).

The original handoff framed this as a "re-skin to match the serials aesthetic."
Investigation showed the serials/timeline pages are deliberately *plainer* than
the current dashboard, so a literal re-skin would be a visual downgrade. The
agreed real goal is: **new metrics + modern look + serial-tool consistency via
drill-downs + cross-links** — all four, in one PR.

## Non-Goals

- No change to the existing `pages/procurement/field-stock/index.tsx` dashboard.
- No nav link to v2 yet — the page is orphaned (promotion to default is a
  separate follow-up PR after parallel-run validation).
- No database migration — all metrics are computable from existing columns
  (verified against the live DB 2026-05-25).
- No true historical *trend lines* — we don't store snapshots. We deliver a
  point-in-time install→activate funnel instead. A 30-day activation trend from
  `serial_events` is an explicit stretch goal, not in scope for v1.

## Route & Layout

- **Page:** `pages/procurement/field-stock/dashboard-v2.tsx`, wrapped in
  `<AppLayout>` (locked convention #14). Orphaned — no nav entry (#11).
- **Look:** modern, denser layout built on the app's `var(--ff-*)` theme tokens
  (consistent with the rest of FibreFlow), NOT the bare-`neutral-*` serials
  style. Consistency with the serial tools is achieved through shared chrome and
  drill-down links, not by copying the plain table look.
- Existing `index.tsx` must keep rendering unchanged (parallel-run proof in PR).

## Data Layer

**New flat API:** `pages/api/procurement/field-stock/dashboard-v2.ts`
- Flat route (locked #12), `withAuth` with `ff_auth_token` (locked #6).
- Built on `pg.Pool` via the neon-compatible `sql` tagged template from
  `@/lib/db-pool` — deliberately NOT the legacy `neon()` shim the old
  `dashboard.ts` uses (avoids the serverless-shim tech debt;
  `project_neon_serverless_debt`).
- Returns **only the four new groups** (NOT a superset of the old summary —
  YAGNI: the v2 page renders only these four, and "live serials" is derived from
  `serialsLifecycle`). The existing `dashboard.ts` is left as-is and remains the
  data source for the old page.
- Thin handler delegating to a `dashboardV2Service.getDashboardV2Summary()` so
  the SQL shaping logic is unit-testable independent of the HTTP boundary
  (mirrors the existing serials/search service+handler split).

### Response shape

```ts
interface DashboardV2Summary {
  stockValue: {
    total: number;
    byLocation: { name: string; type: string; value: number; itemCount: number }[];
  };
  contractorExposure: {
    totalHeldValue: number;
    totalUnaccountedValue: number;
    totalPendingRecovery: number;
    blockedCount: number;
    top: { name: string; heldValue: number; unaccountedValue: number; isBlocked: boolean }[];
  };
  serialsLifecycle: {
    byStatus: Record<string, number>;   // all 11 states
    installed: number;
    activated: number;
    recentlyInstalled: number;          // installed_date > now - 7d
    recentlyActivated: number;          // status='activated' & status_changed_at > now - 7d
  };
  ageing: {
    thresholdDays: number;              // named constant, default 30
    stagnantStockCount: number;         // quants with last_movement_date older than threshold
    stagnantStockValue: number;
    serialsIssuedNotInstalled: number;  // status in (issued,in_transit) & status_changed_at older than threshold
  };
}
```

### SQL sources (verified columns, live DB 2026-05-25)

- **Stock value:** `stock_quants` — `COALESCE(total_value, quantity*unit_cost, 0)`,
  grouped by `location_id` joined to `stock_locations(name, location_type)`.
- **Contractor exposure:** `contractor_stock_accountability` — `current_held_value`,
  `unaccounted_value`, `pending_recovery_amount`, `is_blocked`. Top N by
  `unaccounted_value` desc (N=10).
- **Serial lifecycle:** `stock_serials.status` (11-state CHECK), `installed_date`,
  `activated_at_olt_id`, `status_changed_at`.
- **Ageing:** `stock_quants.last_movement_date`; `stock_serials.status` +
  `status_changed_at`.

Each group is **one** SQL query; the four run in parallel via `Promise.all`
(deterministic call order, so the service is unit-testable by queueing four
mocked `sql` resolutions). Numeric columns cast to `Number()` on the way out.
Null-safe throughout. The KPI hero "Live serials" figure is the sum of
`serialsLifecycle.byStatus` values — no separate query.

**Service file:** `src/modules/procurement/field-stock/services/dashboardV2Service.ts`
exporting `getDashboardV2Summary(): Promise<DashboardV2Summary>`.

## Page Composition

File-size discipline (reviewer-enforced: page <300 lines, component <200;
`feedback_file_size_limit_strict`). Sub-components extracted into
`src/components/field-stock/dashboard-v2/`:

1. **`KpiHeroRow`** — 4 headline cards: Stock value (R), Unaccounted exposure (R),
   Live serials, Ageing alerts.
2. **`StockValueByLocation`** — value per warehouse/site (bar + compact table).
3. **`ContractorExposureTable`** — top contractors by held / unaccounted value;
   row click → Accountability tab.
4. **`SerialLifecyclePanel`** — 11-state breakdown + install→activate funnel;
   state click → `/procurement/field-stock/serials?status=<state>`.
5. **`AgeingPanel`** — stagnant stock + issued-not-installed counts; links to
   filtered lists.

- Data via a small `useDashboardV2` hook (mirrors the existing
  `useFieldStockDashboard` hook pattern).
- Shared types live in `src/types/field-stock/` (locked #13 — services/types
  never import from `src/components/`). Add `DashboardV2Summary` there.
- Rand values formatted via the existing currency formatter (ZAR, no decimals on
  headline cards).

## Drill-down / cross-link map

| Surface | Links to |
|---|---|
| Contractor exposure row | Field-stock Accountability tab |
| Serial lifecycle state | `/procurement/field-stock/serials?status=<state>` |
| Ageing — issued-not-installed | serials register filtered to issued/in_transit |
| KPI cards | corresponding section anchor / existing tab |

## Error Handling

- API: try/catch → `apiResponse.internalError`; `log.error` with context
  (`field-stock/dashboard-v2`). Method guard → `methodNotAllowed`.
- Page: loading spinner; error panel with retry; empty-state per section when a
  group returns zero rows (no blank cards).

## Verification

- `npm run ci:quick` (baselines: 0 lint errors, warnings/silent-catches must not
  regress) + `npm run build`.
- **Playwright MCP** browser smoke (`mcp__playwriter__execute`,
  `feedback_browser_playwright`): load `/procurement/field-stock/dashboard-v2`,
  screenshot each section; AND load the old `/procurement/field-stock` to prove
  it still renders. Screenshots in PR body (Hard Rule 4).
- Cross-check at least one headline number against a direct SQL query
  (`feedback_cross_check_stats`).

## Review & Ship

- PR will be ~600–800 lines across page + API + components + types → **review-team**
  (multi-agent), not single `/review` (`feedback_review_team_for_code_prs`). Never
  self-review.
- Wait for CI green on the `velo-fibreflow` self-hosted runner
  (`gh run watch <id> --exit-status`).
- Merge after blind-approve + CI green → `gh pr merge <N> --merge --delete-branch`
  → remove worktree → `bash scripts/deploy-local.sh dev`.

## Locked Wave 2 conventions honored

#1 desktop persona · #2 augment-not-replace · #6 withAuth · #7 existing pages
untouched · #9 no migration (schema probed first) · #11 orphaned route · #12 flat
API route · #13 shared types in `src/types/field-stock/` · #14 `<AppLayout>` ·
#15 Playwright smoke with screenshots.
