# Slice B — Hide self-registered field workers from HR/payroll (G2)

**Date:** 2026-06-15
**Branch:** `feature/fieldworker-hr-hiding` (worktree off `origin/master` @ `ff3568d00`)
**Spec:** `docs/superpowers/specs/2026-06-15-field-worker-self-registration-v2-design.md` §G2
**Predecessor:** Slice A (PR #1976, merged `ff3568d00`) — added `role='casual'`, `source='self_registered'`,
`account_status='pending'` for self-registered workers. They are `status='active'`, so they **leak** into
HR/employee surfaces. Slice B hides them. Storeman-created `pending` technicians leak the same way and are
fixed by the same filters.

## Goal

Self-registered field workers (`role IN ('technician','casual')`) and unapproved (`account_status='pending'`)
workers must not appear in HR/employee/payroll/attendance-reporting surfaces, while still:
- clocking in and showing **approved** hours in attendance/operational surfaces (Rule P keeps approved techs);
- remaining fully visible to stores / field-stock / technician-picker flows (DO NOT TOUCH).

No schema change. No new mechanism. Builds on existing `staff.role` + `staff.account_status` (migration 346) and
`staff.source` (migration 420). Every edit is **additive** (one predicate ANDed into an existing query).

## Two rules (shared fragments — single source of truth)

New module `src/lib/staff/hrVisibilityFilters.ts` exports two **alias-parameterised** helpers returning a bare
boolean predicate (no leading `AND`/`WHERE`), so each call site chooses the keyword and the table alias:

```ts
// Rule H — HR/employee surfaces: TRUE for employees, FALSE for self-reg field workers.
export function hrEmployeePredicate(alias = 's'): string
//   → (s.role NOT IN ('technician','casual') OR s.role IS NULL)
//   role CHECK constraint guarantees lowercase, so no LOWER() needed; the OR…IS NULL
//   keeps NULL-role legacy employees visible (NOT IN with NULL → NULL → would drop them).

// Rule P — attendance/operational surfaces: TRUE for everyone except PENDING (unapproved).
export function approvedAccountPredicate(alias = 's'): string
//   → (s.account_status IS NULL OR LOWER(s.account_status) <> 'pending')
//   LOWER() because account_status casing is mixed in the shared DB; the IS NULL keeps
//   legacy employees (NULL account_status) visible (NULL <> 'pending' → NULL → would drop them).
```

`alias=''` yields bare column refs (`role`, `account_status`) for single-table `FROM staff` queries; `alias='s'`
(default) yields `s.role` etc. for joined/self-joined queries.

### Injection mechanisms (3 query styles in this codebase)

1. **Neon/db-pool tagged template** (`sql\`...\``): inject via the shim's verbatim sentinel —
   `${sql.unsafe('AND ' + hrEmployeePredicate('s'))}`. Both `@/lib/db-pool` and the `@neondatabase/serverless`
   shim implement `sql.unsafe(raw)` (inlined verbatim, `$N` numbering preserved around it). WHERE-less queries
   use `${sql.unsafe('WHERE ' + hrEmployeePredicate('s'))}`.
2. **Raw text WHERE builders** (`parts.push(...)` + `sql.query(text, params)`): push the bare predicate string
   directly — `parts.push(approvedAccountPredicate('s'))`. No `sql.unsafe` needed.
3. **Plain string + `query(text, [])`** (teamService): interpolate the predicate text into the JS template
   string directly — `... AND ${hrEmployeePredicate('')} ...`.

### Precedence trap (must wrap, not just append)

Where an existing `WHERE` is an **unparenthesised** disjunction (`WHERE status='active' OR is_active=true`),
appending `AND <pred>` binds to the right operand only (`status='active' OR (is_active AND pred)`) and a field
worker with `status='active'` still leaks. These sites get the existing OR wrapped in parens:
`WHERE (status='active' OR is_active=true) AND <pred>`. Affected: `alerts.ts` compliance count + stats.

## Surface map

### Rule H — HR / employee / payroll (exclude `role IN ('technician','casual')`)

| # | File | Queries | Alias | Note |
|---|------|---------|-------|------|
| H1 | `src/services/staff/staffGetService.ts` | 10 list/search branches (`listAll`…`listBySearchDeptStatusPos`) | `s` | `getStaffById` (single record by id) intentionally **not** filtered. |
| H2 | `src/services/staff/neon/statistics.ts` | 5 counts (total, active, inactive, on_leave, dept breakdown) | bare | total + dept have no WHERE → add `WHERE`. Capture `const sql = getSql()`. |
| H3 | `src/services/staff/neon/queryBuilders.ts` | `queryStaffWithFilters` (5 branches), `queryActiveStaff`, `queryProjectManagers` | `s` / bare | self-join `FROM staff s LEFT JOIN staff m` → MUST use `s` (bare `role` ambiguous). `queryStaffById`/`baseStaffQuery` out of scope. |
| H4 | `pages/api/staff/alerts.ts` | birthdays, staffExpiry, docExpiry(join), compliance count, compliance stats, missingDocs | bare/`s` | count + stats have **unparenthesised OR** → wrap. Others parens-safe → append. |
| H5 | `pages/api/staff/payslips/import.ts` | `resolveStaffByEmail` | bare | db-pool `sql`. |
| H6 | `src/modules/payslips/staffMatcher.ts` | matcher SELECT | bare | db-pool `sql`; test mock needs `.unsafe`. |
| H7 | `src/modules/payslips/services/previewImport.ts` | staff dropdown list | bare | db-pool `sql`; test mock needs `.unsafe`. |
| H8 | `pages/api/departments/[id].ts` | dept staff list + delete-guard count | `s` / bare | |
| H9 | `pages/api/departments/[id]/report.ts` | staff-row queries | `s`/bare | per-query (read at edit time). |
| H10 | `pages/api/admin/users/provision-from-staff.ts` | unprovisioned-staff SELECT | `s` | field workers must not auto-provision login users. |
| H11 | `src/modules/noc/services/teamService.ts` | `getUsersForDropdown` | bare | plain string + `query()`; interpolate predicate text. |

### Rule P — attendance / operational (exclude `account_status='pending'`; keep approved techs)

| # | File | Injection | Alias |
|---|------|-----------|-------|
| P1 | `src/services/attendance/searchQueries.ts` `buildBaseWhere` | `parts.push(approvedAccountPredicate('s'))` (covers count+totals+rows+export) | `s` |
| P2 | `src/services/attendance/reports/sqlHelpers.ts` `buildBaseWhere` | add optional `accountStatusRef`; push predicate when set | caller-supplied |
| P2a | `reports/{deptRollup,wageCost,otTrend,monthlyTotals,geoMismatch,bceaPremium}.ts` | pass `accountStatusRef: 's.account_status'` to each staff-joining `buildBaseWhere` call | `s` |
| P3 | `pages/api/staff/attendance-roster.ts` | `AND approvedAccountPredicate('s')` | `s` (test mock needs `.unsafe`) |
| P4 | `pages/api/staff/attendance-pulse-signals.ts` | no-show queries (×2) `AND approvedAccountPredicate('s')` | `s` |
| P5 | `pages/api/staff/attendance-export.ts` | `AND approvedAccountPredicate('s')` | `s` |
| P6 | `pages/api/staff/attendance-week.ts` | `AND approvedAccountPredicate('s')` | `s` |
| P7 | `src/services/attendance/reports/geofencePatterns.ts` | `AND approvedAccountPredicate('s')` | `s` |

### Flag for Hein — NO change in Slice B (product decision)

- `pages/api/projects/[projectId]/team-search.ts` — a PM may legitimately add a technician to a project team.
- `pages/api/realtime/poll.ts` — realtime presence; unclear whether field workers should surface.

### DO NOT TOUCH — must keep seeing technicians (verify by grep, change nothing)

`src/modules/field-stock-pwa/*`, `pages/api/my/stores/*`, `pages/api/procurement/field-stock/*`,
`pages/api/field/users*`, `pages/api/field/technicians*`.

## Tests

- `src/lib/staff/__tests__/hrVisibilityFilters.test.ts` (always-on):
  - exact-string + alias-variants for both helpers (pins clause, prevents drift);
  - NULL-handling assertions (NULL role visible to HR; NULL account_status visible to attendance).
- **Hiding-audit (behavioural, DB-gated)** — runs the *real* predicate SQL against a read-only `VALUES`
  virtual table (zero mutation, safe on the shared DB), asserting the truth table:
  | role | account_status | passes Rule H (HR) | passes Rule P (attendance) |
  |------|----------------|--------------------|----------------------------|
  | technician | pending | ✗ hidden | ✗ hidden |
  | technician | active | ✗ hidden | ✓ visible |
  | casual | pending | ✗ hidden | ✗ hidden |
  | manager | NULL | ✓ visible | ✓ visible |
  Skips cleanly when no DB is reachable; always-on fragment+coverage tests are the hermetic floor.
- **Surface-coverage test** (always-on): assert each enumerated surface file references a shared helper, so no
  surface is silently missed or hand-rolls a drifting clause.
- Keep existing mock-sql tests green: add a `.unsafe` passthrough to the 4 bare sql mocks
  (`vitest.setup.ts` global neon mock; previewImport, staffMatcher, attendance-roster local `db-pool` mocks).

## Gates / process

- `npx vitest run` scoped to touched tests (full vitest hangs in worktree).
- `npm run ci:quick` green (0 errors, ≤185 warnings).
- Push, `gh pr create`, blind `/review` (review-team if 500+ lines), GHA CI green.
- Merge only after BOTH approve. **Do NOT deploy** (Hein, after-hours — cron + shared DB).
