# Field Workers Admin Page (`/field`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the orphan `/field` page with a Field Workers admin page that approves pending self-registered workers and lets admins/supervisors view & manage their clock-in/out time (including pending workers, who are otherwise hidden).

**Architecture:** Reuse the existing approve/suspend, manual-entry, and corrections-review endpoints plus the guarded correction-approval services. Add one Rule-P-exempt read endpoint and one thin admin-adjust endpoint. The page is a tabbed client view (Approvals + Time) rendered inside `AppLayout` (client-side auth, same as other `/staff/*` pages); all writes are server-gated by permission.

**Tech Stack:** Next.js 14 Pages Router, TypeScript, `pg` via `@/lib/db-pool` (`sql` tagged template), `@/lib/apiResponse`, `@/lib/auth/middleware` (`withAuth`/`withPermission`/`withRole`), vitest, Tailwind, lucide-react.

## Global Constraints

- Files < 300 lines; React components < 200 lines.
- No `console.log` — use `log` from `@/lib/logger`. No empty catch.
- API routes: `import { apiResponse } from '@/lib/apiResponse'`; flattened routes (no nested `[id]/sub.ts`).
- Never raw-`UPDATE attendance_entries` from a handler — use `createAndApproveAdjustmentTxn` from `corrections/guardedApproval` (guard + insert + apply in one transaction) or `attendance-manual-entry` (insert new `status='manual'`).
- Rule P / Rule H (`src/lib/staff/hrVisibilityFilters.ts`) stay unchanged everywhere except the new `/api/field/attendance`, which deliberately omits the `approvedAccountPredicate`.
- "Field worker" = `staff.role IN ('technician','casual')`.
- Run `npm run ci:quick` before every PR; `npx vitest run <file>` per task.

## File Structure

- Modify `pages/api/field/users/index.ts` — add `source`, `declared_project_id` (+ project name) to the GET SELECT (Task 1).
- Create `pages/api/field/attendance.ts` — Rule-P-exempt field-worker clock read (Task 2).
- Create `pages/api/field/attendance-adjust.ts` — admin-initiated time adjust via the audited txn (Task 3).
- Create `src/modules/field-workers/api.ts` — typed client fetchers + row types (Task 4).
- Rewrite `pages/field/index.tsx` — tab shell in `AppLayout` (Task 4).
- Create `src/modules/field-workers/components/{ApprovalsTab,ApprovalRow,TimeTab,WorkerTimeRow,ManualEntryDialog,AdjustTimeDialog}.tsx` (Tasks 4–5).
- Modify `src/modules/navigation/config/modules/staff.config.ts` — add "Field Workers" tab (Task 6).
- Tests: `src/modules/field-workers/__tests__/*.test.ts` + reuse existing vitest setup.

---

### Task 1: Extend `GET /api/field/users` with `source` + declared project

**Files:**
- Modify: `pages/api/field/users/index.ts` (GET SELECT, ~lines 232–265)
- Test: `src/modules/field-workers/__tests__/field-users-source.test.ts`

**Interfaces:**
- Produces: GET `/api/field/users?accountStatus=pending` now returns rows with extra `source: string | null`, `declared_project_id: string | null`, `declared_project_name: string | null`.

- [ ] **Step 1: Write the failing test** — assert the SELECT projects the new columns. Since the handler builds SQL by branch, test at the SQL-shape level by importing the query builder if extracted, else add an integration-style test that mocks `sql` and asserts the returned columns are passed through.

```ts
// field-users-source.test.ts
import { describe, it, expect, vi } from 'vitest';
// Mock @/lib/db-pool sql to capture the query text
```

(Implementer: follow the existing mock pattern in `src/modules/attendance/__tests__/api/*.test.ts`; assert the GET response objects include `source`, `declared_project_id`, `declared_project_name`.)

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run src/modules/field-workers/__tests__/field-users-source.test.ts`).

- [ ] **Step 3: Implement** — in each GET SELECT branch, change the column list to:

```sql
SELECT s.id, s.first_name, s.last_name, s.phone, s.email, s.role, s.account_status,
       s.created_by_staff_id, s.created_at,
       s.source, s.declared_project_id,
       p.project_name AS declared_project_name
FROM staff s
LEFT JOIN projects p ON p.id = s.declared_project_id
WHERE <existing role/accountStatus branch on s.*>
ORDER BY s.created_at DESC
LIMIT 200
```

Alias `staff` as `s` in all four branches; keep the existing WHERE conditions (now `s.role` / `s.account_status`).

- [ ] **Step 4: Run test — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(field-users): return source + declared project in GET list"`

---

### Task 2: `GET /api/field/attendance` — Rule-P-exempt field-worker clock read

**Files:**
- Create: `pages/api/field/attendance.ts`
- Test: `src/modules/field-workers/__tests__/field-attendance-read.test.ts`

**Interfaces:**
- Produces: `GET /api/field/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD&status=<all|pending|active>` →
  `{ success, data: { rows: FieldAttendanceRow[] } }` where
  `FieldAttendanceRow = { entry_id: string; staff_id: string; staff_name: string; role: string; account_status: string; work_date: string; clock_in_at: string | null; clock_out_at: string | null; entry_status: string; hours: number | null; entry_updated_at: string; site_geofence_id: string | null }`.
- Auth: `withAuth(withPermission('people.staff.attendance.search', 'view')(handler))`.

- [ ] **Step 1: Write the failing test** — assert: (a) returns a pending technician's entry (proves Rule-P exemption), (b) excludes a non-field role (e.g. `manager`), (c) computes `hours` null when `clock_out_at` is null. Mock `sql` to return fixture rows and assert the WHERE text contains `role IN ('technician','casual')` and does **NOT** contain `account_status` <> 'pending'.

```ts
it('includes pending technician and excludes non-field roles, no Rule-P predicate', async () => {
  // mock sql; capture query text; assert role filter present, no approvedAccountPredicate
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `pages/api/field/attendance.ts`:

```ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? '');
  const status = String(req.query.status ?? 'all'); // all | pending | active
  if (!DATE.test(from) || !DATE.test(to)) return apiResponse.badRequest(res, 'from and to must be YYYY-MM-DD');
  try {
    // NOTE: deliberately NO approvedAccountPredicate (Rule P) — this is the
    // field-worker management surface; pending workers MUST be visible here.
    const rows = await sql`
      SELECT e.id AS entry_id, s.id AS staff_id,
             TRIM(COALESCE(s.first_name,'')||' '||COALESCE(s.last_name,'')) AS staff_name,
             s.role, s.account_status,
             to_char(e.work_date,'YYYY-MM-DD') AS work_date,
             e.clock_in_at, e.clock_out_at, e.status AS entry_status,
             e.site_geofence_id, e.updated_at::text AS entry_updated_at,
             CASE WHEN e.clock_out_at IS NULL THEN NULL
                  ELSE ROUND(EXTRACT(EPOCH FROM (e.clock_out_at - e.clock_in_at))/3600.0, 2) END AS hours
      FROM attendance_entries e
      JOIN staff s ON s.id = e.staff_id
      WHERE s.role IN ('technician','casual')
        AND e.work_date BETWEEN ${from} AND ${to}
        ${status === 'pending' ? sql`AND LOWER(s.account_status) = 'pending'`
          : status === 'active' ? sql`AND LOWER(s.account_status) = 'active'` : sql``}
      ORDER BY s.first_name, s.last_name, e.work_date DESC
      LIMIT 1000`;
    return apiResponse.success(res, { rows });
  } catch (err) {
    log.error('[field-attendance] query failed', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('people.staff.attendance.search', 'view')(handler));
```

> **Implementer note:** `@/lib/db-pool`'s `sql` is the Neon-shim tagged template. Conditional `${cond ? sql\`…\` : sql\`\`}` interpolation is **known-broken** on the shim (per CLAUDE.md). Use explicit query branches instead: write three full query variants (all / pending / active) selected by an `if`, OR build with `@/lib/db` `pg.Pool` (`db.query(text, params)`) which is unaffected. Prefer the `pg.Pool` route via `@/lib/db` with a parameterized text query and a conditional `AND` appended in JS.

- [ ] **Step 4: Run test — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(field): Rule-P-exempt field-worker attendance read endpoint"`

---

### Task 3: `POST /api/field/attendance-adjust` — admin-initiated time fix

**Files:**
- Create: `pages/api/field/attendance-adjust.ts`
- Test: `src/modules/field-workers/__tests__/field-attendance-adjust.test.ts`

**Interfaces:**
- Consumes: `createAndApproveAdjustmentTxn` and `ApproveResult` from `@/modules/attendance/corrections/guardedApproval`.
- Produces: `POST /api/field/attendance-adjust` body `{ entry_id: string; adjusted_clock_in_at?: string|null; adjusted_clock_out_at?: string|null; reason: string; entry_updated_at: string }` → `{ success, data: { adjustment } }`; `409` on `entry_changed`/`adjustment_not_pending`/locked week.
- Auth: `withAuth(withPermission('people.staff.attendance.corrections', 'edit')(handler))`.

- [ ] **Step 1: Confirm bounded unknowns (read, don't guess):**
  - `AdjustmentKind` allowed values: inspect `src/modules/attendance/corrections/types.ts` and use the value the `/my` correction-request flow uses for a time edit.
  - Reuse the canonical in-transaction guard through `createAndApproveAdjustmentTxn`; a pre-transaction lock lookup is not mutation authority.

- [ ] **Step 2: Write the failing test** — (a) happy path calls `createAndApproveAdjustmentTxn` and returns the adjustment; (b) stale `entry_updated_at` → txn returns `{ok:'conflict', reason:'entry_changed'}` → handler 409; (c) `reason` < 10 chars → 400; (d) active/orphan locks return 409 without a persisted insert.

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement the bounded route contract:**
  1. Validate IDs, reason, and optional timestamps before DB work.
  2. Resolve `req.user.id` to exactly one `staff.id` through `staff.user_id`; return 409 if the link is missing or ambiguous. `requested_by` references `staff(id)`.
  3. Load the target entry and call `createAndApproveAdjustmentTxn` with `requestedBy=staff.id` and `reviewerId=req.user.id`. `reviewed_by` references `users(id)`.
  4. Map guarded `period_locked` errors and optimistic conflicts to 409. Do not add a pre-transaction lock lookup.

- [ ] **Step 5: Run test — expect PASS.**
- [ ] **Step 6: Commit** — `git commit -m "feat(field): admin-initiated attendance adjust via audited txn"`

---

### Task 4: `/field` page shell + Approvals tab (replace old content)

**Files:**
- Create: `src/modules/field-workers/api.ts` (typed fetchers + types)
- Rewrite: `pages/field/index.tsx`
- Create: `src/modules/field-workers/components/ApprovalsTab.tsx`, `ApprovalRow.tsx`
- Test: `src/modules/field-workers/__tests__/api.test.ts`

**Interfaces:**
- `src/modules/field-workers/api.ts` exports: `listPendingFieldWorkers(): Promise<PendingWorker[]>`, `approveWorker(userId): Promise<void>`, `rejectWorker(userId): Promise<void>`, `getFieldAttendance(from,to,status): Promise<FieldAttendanceRow[]>`, `adjustEntry(payload): Promise<void>`, `addManualEntry(payload): Promise<void>`, `reviewCorrection(payload): Promise<void>`. Types `PendingWorker`, `FieldAttendanceRow` (matches Task 2).

- [ ] **Step 1: Write `api.ts`** — thin `fetch` wrappers, `credentials:'same-origin'`, throw on `!res.ok`. Exact calls:
  - `listPendingFieldWorkers` → `GET /api/field/users?accountStatus=pending` → `body.data` (rows). Filter client-side to `role==='technician'||'casual'`.
  - `approveWorker(id)` → `POST /api/field/users/approve?userId=${id}`.
  - `rejectWorker(id)` → `POST /api/field/users/suspend?userId=${id}`.
  - `getFieldAttendance` → `GET /api/field/attendance?from=&to=&status=` → `body.data.rows`.
  - `adjustEntry` → `POST /api/field/attendance-adjust` (body per Task 3).
  - `addManualEntry` → `POST /api/staff/attendance-manual-entry` body `{staff_id, clock_in_at, clock_out_at, site_geofence_id?, notes}` (notes ≥ 10).
  - `reviewCorrection` → `POST /api/staff/attendance-corrections-review` body `{adjustment_id, action, review_note}`.
- [ ] **Step 2: Test `api.ts`** — mock `fetch`, assert each fetcher hits the right URL/method/body. Run → FAIL → implement → PASS.
- [ ] **Step 3: Rewrite `pages/field/index.tsx`** — render inside `AppLayout` (import the same layout `/staff/*` pages use; confirm with `grep -n "AppLayout" pages/staff/attendance/corrections.tsx`). Tab state `'approvals' | 'time'`. Use `useAuth()` to read the current role; pass `isAdmin = ['admin','super_admin','system'].includes(role)` to children. Render `<ApprovalsTab isAdmin=… />` and `<TimeTab isAdmin=… />`. Keep this file < 120 lines — logic lives in the tab components.
- [ ] **Step 4: `ApprovalsTab.tsx` + `ApprovalRow.tsx`** — `ApprovalsTab` loads `listPendingFieldWorkers()` on mount, renders rows; empty state "No pending registrations." `ApprovalRow` shows name/phone/declared_project_name/source/created_at + (if `isAdmin`) Approve/Reject buttons calling `approveWorker`/`rejectWorker`, then removes the row + toast. Disable buttons while in flight. Each component < 200 lines.
- [ ] **Step 5: Verify** — `npm run ci:quick` (lint + changed-files clean). Build the worktree (`npm run build`) and screenshot `/field` (Approvals tab) at desktop + mobile via the browser per CLAUDE.md UI rule — confirm the pending queue + admin-only buttons render.
- [ ] **Step 6: Commit** — `git commit -m "feat(field): Field Workers page shell + Approvals tab"`

---

### Task 5: Time tab + Manual-entry & Adjust dialogs

**Files:**
- Create: `src/modules/field-workers/components/TimeTab.tsx`, `WorkerTimeRow.tsx`, `ManualEntryDialog.tsx`, `AdjustTimeDialog.tsx`

**Interfaces:**
- Consumes `getFieldAttendance`, `adjustEntry`, `addManualEntry`, `reviewCorrection` from `api.ts`.

- [ ] **Step 1: `TimeTab.tsx`** — date-range picker (default = current SAST week), status filter (all/pending/active), loads `getFieldAttendance`, groups rows by worker; "Add entry" opens `ManualEntryDialog`; each entry row is a `WorkerTimeRow`. Empty state "No clock activity in range." < 200 lines.
- [ ] **Step 2: `WorkerTimeRow.tsx`** — shows date, clock-in/out (or "— open"/"missing"), hours, status badge; "Fix time" opens `AdjustTimeDialog` for that entry (passing `entry_id`, current times, `entry_updated_at`). < 150 lines.
- [ ] **Step 3: `ManualEntryDialog.tsx`** — fields staff (preselected worker), clock_in_at, clock_out_at, notes (≥10, enforced client-side with helper text); submit → `addManualEntry` → refresh + toast; surfaces 409 "week locked" cleanly. < 180 lines.
- [ ] **Step 4: `AdjustTimeDialog.tsx`** — edit clock-in and/or clock-out + reason (≥10); submit → `adjustEntry` with the row's `entry_updated_at`; on 409 show "changed since you loaded — refresh" and re-fetch. < 180 lines.
- [ ] **Step 5: Corrections approve/reject** — in `TimeTab`, if any rows have linked pending worker-submitted corrections, surface an "Approve/Reject" control that calls `reviewCorrection`. (If wiring the corrections list here is more than trivial, defer to a follow-up and link to `/staff/attendance/corrections` — note this decision in the PR.)
- [ ] **Step 6: Verify** — vitest for any pure helpers; `npm run ci:quick`; build + browser screenshot of the Time tab (desktop + mobile) showing a worker's entries + the Fix-time and Add-entry dialogs.
- [ ] **Step 7: Commit** — `git commit -m "feat(field): time management tab (view, manual entry, adjust)"`

---

### Task 6: Navigation entry

**Files:**
- Modify: `src/modules/navigation/config/modules/staff.config.ts`

- [ ] **Step 1:** Add to `staffConfig.tabs` (same shape as the `departments` item):

```ts
{
  id: 'field-workers',
  label: 'Field Workers',
  icon: HardHat, // import { HardHat } from 'lucide-react'
  path: '/field',
  rbacKey: 'people.staff.attendance.manage',
},
```

Confirm the nav renders absolute `path: '/field'` correctly even though `basePath` is `/staff` (`grep -n "path" src/modules/navigation/config/modules/*.config.ts` for precedent of a tab pointing outside basePath; if the nav requires same-basePath tabs, register a small top-level module entry instead).

- [ ] **Step 2: Verify** — `npm run ci:quick`; load the app, confirm "Field Workers" appears for an attendance-permissioned user and links to `/field`.
- [ ] **Step 3: Commit** — `git commit -m "feat(nav): add Field Workers entry"`

---

## Self-Review

- **Spec coverage:** Approvals (Task 1 data + Task 4 UI), time view incl. pending/Rule-P-exempt (Task 2 + Task 5), add missing entry (Task 5 manual-entry reuse), fix/adjust (Task 3 + Task 5), approve worker corrections (Task 5 reuse), RBAC admin+supervisors w/ admin-only approve (Tasks 2/3/4 auth + nav rbacKey), nav (Task 6). All covered.
- **Placeholders:** Two deliberate bounded lookups in Task 3 Step 1 (the exact `AdjustmentKind` value and the lock-check helper) are explicit read-then-use steps, not vague TODOs — the `'time_edit' as never` token MUST be replaced in that step. The conditional-`sql` shim caveat in Task 2 is flagged with the `pg.Pool` alternative.
- **Type consistency:** `FieldAttendanceRow` defined in Task 2 is reused verbatim in Task 4 `api.ts` and Task 5. `entry_updated_at` flows Task 2 → row → Task 5 dialog → Task 3 `entry_updated_at` param → `createAndApproveAdjustmentTxn.entryUpdatedAt`.
- **Risks:** manual-entry's `authorizedToSuperviseStaff` scope gate may reject a manager who doesn't "supervise" a given field worker in the supervisor chain — verify during Task 5; admins bypass. Confirm in implementation.
