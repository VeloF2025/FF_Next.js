# Field Workers Admin Page (`/field`) — Design

**Date:** 2026-06-24
**Status:** Approved (design); pending spec review
**Author:** Claude (Opus) with Hein

## Problem / context

Self-registered field workers (role `technician` or `casual`, `source='self_registered'`, created via `POST /api/my/register`) land in `staff` with `account_status='pending'`. Two gaps make them unmanageable:

1. **No approval UI.** `POST /api/field/users/approve` (pending→active) and `/suspend` exist and are admin-only, but **nothing in the app calls them**. A pending worker stays pending forever unless someone hits the API or edits the DB.
2. **No time visibility.** Pending workers *can* clock in (login gates on `staff.status='active'`, not `account_status`; only `suspended` is blocked) — so they accumulate `attendance_entries`. But the HR-visibility rules hide them:
   - **Rule H** (`hrEmployeePredicate`) hides ALL `technician`/`casual` from the staff directory, payroll, HR lists.
   - **Rule P** (`approvedAccountPredicate`) hides `pending` accounts from **every** attendance admin surface (Pulse search, roster, week, export, reports).
   So an admin cannot see a pending field worker's clock-in/out **anywhere** today.

`/field` is currently an unauthed "Field App Portal" (Tasks/Technicians/Overview tabs), not linked in any nav, with no overlap to these needs. We will **replace it** with a Field Workers admin page.

## Goals

- One page at `/field` to (a) approve/reject pending field workers and (b) view & manage their clock-in/out time — **including pending workers**.
- Reuse the existing, audited time-edit paths; never raw-UPDATE `attendance_entries`.
- Proper auth (the page is currently public).

## Non-goals (YAGNI)

- Weekly payroll lock (org-wide `/staff/attendance/locks` already covers it).
- CSV/XLSX export (can be added later).
- Changing Rule H / Rule P anywhere except the one new field-worker read endpoint described below.
- Touching the `/my` self-service portal.

## Definitions

- **Field worker** = `staff.role IN ('technician','casual')`, any `account_status`.
- **Pending queue** = field workers with `account_status='pending'`.

## Access control

- Page `/field`: `withAuth` + visible to **admin + managers/supervisors**, gated by the existing `people.staff.attendance.*` permission set (view tier). 
- **Approve / Reject** actions: admin-only — rendered only for admins **and** enforced server-side by the existing `withAuth(withRole('admin'))` on `/approve` and `/suspend`.
- **Time edits** (manual entry, corrections, adjustments): gated by `people.staff.attendance.corrections` (edit), server-enforced by the reused endpoints.

## Design

### Page `/field` (replaces the old portal)
- Server-rendered shell with `withAuth`; client tabs. Add a **"Field Workers"** entry to the staff/HR nav config (currently an orphan route).
- Composed of small focused components (each < 200 lines): `FieldWorkersPage` (tab shell), `ApprovalsTab`, `ApprovalRow`, `TimeTab`, `WorkerTimeRow`, `ManualEntryDialog`, `AdjustTimeDialog`. Shared data hooks in a `field-workers` module folder.

### Tab 1 — Approvals (pending queue)
- **Read:** `GET /api/field/users?accountStatus=pending` — extend the handler's SELECT to also return `source` and `declared_project_id` (joined to a project name) so reviewers see self-registered vs storeman-created and the declared site. (Additive change; existing callers unaffected.)
- **Row:** name, phone, declared project, source, registered date.
- **Actions (admin only):** **Approve** → `POST /api/field/users/approve?userId=`; **Reject** → `POST /api/field/users/suspend?userId=`. Both already exist. Optimistic row update + toast on the API's confirmed response.

### Tab 2 — Time (clock-in/out management; includes pending)
- **Read (NEW):** `GET /api/field/attendance?from=&to=&status=` — returns, per field worker per work-date: `clock_in_at`, `clock_out_at`, computed hours, entry `status`, and open/missing flags.
  - Scoped to `role IN ('technician','casual')`.
  - **Deliberately exempt from Rule P** so pending workers' time is visible — this *is* the field-worker management surface. Rule P/Rule H remain untouched everywhere else. The exemption is a documented, single-purpose decision local to this endpoint; permission gate (`attendance.search`/`manage`) still applies.
  - Reuses the existing attendance query/aggregation helpers where practical, minus the Rule-P predicate.
- **Actions per entry** — all through existing, audit-preserving paths (no raw edit of clock rows):
  - **Add missing entry** → existing `POST /api/staff/attendance-manual-entry` (`status='manual'`, min-10-char note, blocked if week locked).
  - **Fix/adjust a wrong time** → **one thin NEW endpoint** `POST /api/field/attendance-adjust` that calls `createAndApproveAdjustmentTxn` from `corrections/guardedApproval`. The canonical lock guard, pending adjustment insert, approval, optimistic entry update, and projection invalidation share one transaction.
    - Resolve the authenticated `users.id` through `staff.user_id`: store the unique `staff.id` in `requested_by` and retain `users.id` in `reviewed_by`. Reject a missing or ambiguous link rather than inventing a staff requester.
  - **Approve/reject worker-submitted corrections** → existing `POST /api/staff/attendance-corrections-review`.

## Data flow

1. Page load → `withAuth` → render tabs by permission.
2. Approvals tab → fetch pending list → admin clicks Approve/Reject → existing endpoint → row refresh.
3. Time tab → pick date range + optional status filter → `GET /api/field/attendance` → render workers + entries → edit actions call the reuse/thin endpoints → re-fetch affected rows.

## Error handling / edge cases

- **Locked week:** manual-entry and adjust endpoints already 409 on locked weeks; surface a clear toast.
- **Optimistic concurrency:** adjust uses the existing `entry.updated_at` guard → 409 on concurrent edit; prompt re-fetch.
- **Open entries** (clocked in, not out): shown with an "on shift / open" flag; admin can close via manual-entry/adjust.
- **Non-admin** hitting approve/suspend → existing endpoints return 403; buttons hidden client-side regardless.
- **Empty states:** "No pending registrations" / "No clock activity in range."

## Reused vs new

| Reused as-is | New |
|--------------|-----|
| `/api/field/users/approve`, `/suspend` | `/field` page + components (replace old content) |
| `/api/staff/attendance-manual-entry` | `GET /api/field/attendance` (Rule-P-exempt, field-worker scoped) |
| `/api/staff/attendance-corrections-review` | `POST /api/field/attendance-adjust` (thin; calls guarded create+approve) |
| guarded approval services, adjustments status-machine, `clockUtils` | `source`+project added to `GET /api/field/users` response |
| HR-visibility rules (unchanged everywhere else) | "Field Workers" nav entry |

## Testing

- **Unit:** `GET /api/field/attendance` returns pending + active field workers (asserts the Rule-P exemption is intentional and scoped to `technician`/`casual`); excludes non-field roles.
- **Unit:** `attendance-adjust` guards + inserts + applies in one transaction; 409 on stale `updated_at`; 409 on active or orphan locked state without a persisted insert.
- **RBAC:** approve/suspend reject non-admin (403); time read allowed for attendance-permission holders; edits require `attendance.corrections`.
- **Approvals list:** returns `source`/project; existing `/api/field/users` callers unaffected by the additive columns.

## Risks / open items

- **Rule-P exemption blast radius:** confined to the new `/api/field/attendance` endpoint only. A test pins that no other surface loses the predicate.
- **Adjust-vs-manual overlap:** "fix existing time" (adjust) vs "add missing day" (manual-entry) are distinct actions in the UI to avoid confusion.
- The existing attendance aggregation helpers may need a small param to skip the Rule-P predicate cleanly rather than duplicating SQL — to be settled in the plan.
