# PRD — Velocity Fibre Staff Pulse: Cross-Period Search & HR Reports (`/staff` → Pulse)

| Field | Value |
|---|---|
| Document | Product Requirements Document |
| Version | 0.1 — draft |
| Author | Hein van Vuuren (product), Claude (drafting) |
| Date | 2026-04-26 |
| Status | Draft — pending product/legal review |
| Related | PRD-040 — Unified Staff Portal (`/my`) |
| Related | `attendanceNavConfig.ts`, `AttendanceNav.tsx` |
| Related | PR #1484 (migration 329 — legacy URL rewrite), PR #1485 (`schema_migrations` tracker backfill) |
| Related | Receipts feature shipped 2026-04-25: PRs #1474–#1487 |

---

## 1. Executive summary

Velocity Fibre's admin attendance area at `/staff/attendance/*` is functionally complete for daily operations — today's roster, the weekly dashboard, the corrections queue, payroll-week locks and the Cartrack ↔ staff mapping all live. But every HR question that crosses staff or crosses time still ends in a manual export to Excel:

- "Who was late more than three times in March?" — no answer in-app.
- "What did the OT trend look like for the Civil dept over the last 12 weeks?" — re-derived by hand each month.
- "Lock weeks 14, 15, 16 for everyone in Pretoria" — one click each, 90+ clicks per pay cycle, no audit trail of the bulk action.

**Pulse** is the second-generation admin face of attendance: a renamed first-class tab in `/staff` that adds (a) a cross-staff, cross-period **Search** surface, (b) per-user **Saved Filters**, (c) seven first-party **Reports**, (d) auditable **Bulk Actions**, and (e) an **Action Items** integration. It re-uses every existing API, every existing scope helper, and every existing permission. Only two new permission keys, exactly one new table.

Pulse ships in five independently deployable phases — A (Search) → B (Saved filters) → C (Reports) → D (Bulk actions) → E (Action Items). Total 11–14 working days. No URL churn: the slug `/staff/attendance/*` is preserved for compatibility; only the visible tab label and ModuleNav title change.

---

## 2. Problem statement

### 2.1 Roster is "today only"

`/staff/attendance` shows one row per active staff for the current day. Anything that requires looking up "what did X do on the 11th of last month" forces HR to leave the tool, open Excel, and pivot a CSV export. The data is in the DB; the UI does not surface it.

### 2.2 Week is one week

`/staff/attendance/week` is excellent for the current pay-week, but answering "give me Sipho's last 8 weeks" means flipping the week selector eight times and copy/pasting the totals.

### 2.3 No cross-staff search

There is no view that takes a filter set ("Civil dept, last 30 days, late >5 min") and returns the matching attendance rows. HR re-derives every such question by exporting the full `daily_summaries` table and filtering in Excel.

### 2.4 Recurring reports are re-built each month

Late-arrivals, geo-mismatch, OT trend, BCEA-compliance Sunday/holiday flagging — all of them are produced by HR through ad-hoc spreadsheets every month. None are saved-state in the app, none have an audit trail, and the column shapes drift between months.

### 2.5 Bulk lock is destructive without staged confirm or audit trail

Locking a payroll week is one click per staff member. With ~50 staff that's 50 clicks per week, no batch view of what's about to happen, no per-staff reason field, no single audit row to point at if a lock is later disputed.

---

## 3. Goals & non-goals

### 3.1 Goals (in scope)

- **G1** — Admin can answer any "who / when / where" attendance question without leaving the app, on any combination of staff + date range + dimension.
- **G2** — Admin can save and recall their own filter sets, with a personal default that loads on Search-page open.
- **G3** — HR can run all seven Phase C reports on demand, with consistent column shapes month to month, in XLSX (default) or CSV.
- **G4** — HR can perform bulk weekly locks and bulk correction-request actions with a single confirm modal, an audit row per staff affected, and a reason note carried into the audit.
- **G5** — `/action-centre` surfaces three signals from Pulse (pending corrections count, open exception count, no-show alert), each deep-linking back into the matching Pulse view.

### 3.2 Non-goals (explicitly out of scope)

- **N1** — **No new clock-in surface.** Staff continue to clock in via `/my`. Pulse is admin-only.
- **N2** — **No scheduling.** Pulse is read+manage on what already happened, not a roster builder for what should happen.
- **N3** — **No leave management.** Leave types (annual / sick / family) remain a separate future module; Pulse will display a leave flag where the existing `daily_summaries` already carries one, but it does not allow leave creation/approval.
- **N4** — **No native mobile app.** Pulse is desktop-first admin web; phone responsiveness is a polish item, not a deliverable.

---

## 4. User personas

### 4.1 Super Admin / HR Manager (primary — 1–2 people)

Desktop-first. Owns payroll close, BCEA compliance, and HR escalations. Lives in spreadsheets today; we want them to live in Pulse instead. **Always sees org-wide.** Never narrowed by staffId linkage.

**Needs**: Run any report on demand; bulk-lock a payroll week; trace a single late-arrival or geo-mismatch back to source; save the three filter sets they reuse weekly.

### 4.2 Department Manager (~3–5 people)

Desktop, occasional phone. Responsible for their dept only.

**Needs**: See their staff in Search, filter by their dept by default, run rollup report for their dept. Scope-narrowed to their dept by `supervisorScope`.

### 4.3 Site Supervisor (~5–10 people)

Phone-leaning. Responsible for the site they're currently running.

**Needs**: Today's roster (already live); Search filtered to their site; review the corrections queue for their staff. Scope-narrowed to their site.

### 4.4 Project Manager (~5 people)

Desktop. Cross-site by project.

**Needs**: OT trend and wage-cost rollup for their project. Scope-narrowed by project assignment.

### 4.5 Field Staff (out of scope here)

Field staff use `/my`, never `/staff`. They do not appear in this PRD's user stories — see PRD-040.

---

## 5. Tab placement and naming

### 5.1 Decision

The visible tab label in `/staff` becomes **Pulse**. The URL slug `/staff/attendance/*` is preserved (no churn for bookmarks, deep links, audit logs, or telemetry). The `attendanceNavConfig.ts` ModuleNav title changes from "Attendance" to "Pulse".

### 5.2 Top tab strip — before / after

**Before** (today, in `pages/staff/index.tsx`):

```
Directory · Departments · Alerts · Birthdays · Compliance · Import
```

**After**:

```
Directory · Departments · Pulse · Alerts · Birthdays · Compliance · Import
```

The "Pulse" entry is a top-level tab in `/staff/index.tsx` that deep-links to `/staff/attendance` (the existing Today page). It does NOT replace the existing in-page sub-nav under `/staff/attendance/*` — that ModuleNav (`AttendanceNav.tsx`) keeps its place but its container title becomes "Pulse".

### 5.3 Pulse sub-nav (`AttendanceNav.tsx` driven by `attendanceNavConfig.ts`)

| Sub-tab label | URL slug | Status |
|---|---|---|
| Pulse · Today | `/staff/attendance` | Existing (was: Roster) — relabel only |
| Pulse · Search | `/staff/attendance/search` | **NEW** (Phase A) |
| Pulse · Week | `/staff/attendance/week` | Existing |
| Pulse · Reports | `/staff/attendance/reports/*` | **NEW** (Phase C) |
| Pulse · Corrections | `/staff/attendance/corrections` | Existing |
| Pulse · Locks | `/staff/attendance/locks` | Existing |
| Pulse · Cartrack | `/staff/attendance/cartrack-mapping` | Existing |

`/staff/attendance/overview` remains the executive dashboard; we will keep the URL accessible but fold its tile into the Today page header rather than carrying a "Pulse · Overview" tab — cuts one tab from the strip.

### 5.4 Rename inventory

- `attendanceNavConfig.ts` — `title: 'Attendance'` → `title: 'Pulse'`. Sub-tab `Roster` → `Today`. Add Search and Reports entries.
- `pages/staff/index.tsx` — top tab list gets a `Pulse` entry pointing at `/staff/attendance`.
- `<AttendanceNav>` consumers — no code change required; the constant changes lift through.

---

## 6. User stories

### 6.1 Phase A — Search

#### 6.1.1 Super Admin / HR — answer any cross-staff question

> **AS A** super admin
> **I WANT** to filter `/staff/attendance/search` by staff, dept, site, project, date range, exception type and lateness threshold
> **SO THAT** I can answer "who was late more than 5 minutes between 1 March and 31 March" in under five seconds.

#### 6.1.2 Dept Manager — narrowed by scope

> **AS A** department manager
> **I WANT** Search to default to my department
> **SO THAT** I see my people first, and can't accidentally export org-wide data.

#### 6.1.3 Site Supervisor — narrowed by site

> **AS A** site supervisor
> **I WANT** Search to default to my site
> **SO THAT** I can see today and yesterday for my crew without having to pick the site each time.

### 6.2 Phase B — Saved filters

#### 6.2.1 HR — recall a filter

> **AS A** HR manager
> **I WANT** to save the filter set I run every Monday morning ("last week, all depts, late >5 min")
> **SO THAT** I don't re-pick six filters every Monday.

#### 6.2.2 HR — pin a default

> **AS A** HR manager
> **I WANT** to mark one of my saved filters as default
> **SO THAT** Search opens already filtered the way I work.

### 6.3 Phase C — Reports (one user story per P1 report)

- **6.3.1 Monthly per-staff totals** — *AS A HR manager I WANT a single XLSX with every active staff's hours / OT / exceptions / wage-cost for a given month SO THAT I can hand it to finance for payroll review.*
- **6.3.2 Late arrivals** — *AS A dept manager I WANT a list of every late arrival in the last N days, configurable threshold (default >5 min), SO THAT I can have a discipline conversation with the right people.*
- **6.3.3 Geo-mismatch** — *AS A super admin I WANT a list of clock-ins outside any site geofence SO THAT I can investigate fraud or stale geofence data.*
- **6.3.4 OT trend** — *AS A project manager I WANT OT hours per week per staff, last 12 weeks, with a sparkline, SO THAT I can spot OT creep before payroll close.*
- **6.3.5 Department rollup** — *AS A super admin I WANT total hours / OT / headcount per dept for a date range SO THAT I can compare dept utilisation.*
- **6.3.6 Holiday + Sunday work** — *AS A HR manager I WANT a BCEA-compliance report flagging hours worked on Sundays and public holidays, per staff SO THAT I can apply the correct premium and prove compliance in an audit.*
- **6.3.7 Wage cost rollup** — *AS A finance reviewer I WANT the sum of `wage_amount` per staff per dept for a date range SO THAT I can reconcile against the payroll GL posting.*

### 6.4 Phase D — Bulk actions

#### 6.4.1 Super Admin — bulk lock

> **AS A** super admin
> **I WANT** to select 30 staff in a week view, click "Lock selected", enter a reason, and see one audit row per staff
> **SO THAT** I close payroll in one stroke and can prove afterwards what I did and why.

#### 6.4.2 Dept Manager — bulk correction request

> **AS A** dept manager
> **I WANT** to select multiple exception rows and request corrections in one go with a shared note
> **SO THAT** I'm not opening 12 single-row dialogs.

### 6.5 Phase E — Action Items integration

#### 6.5.1 Super Admin — see attendance signals on the centre

> **AS A** super admin
> **I WANT** `/action-centre` to show "X corrections pending review", "Y exceptions open", "Z staff with no clock-in for 3+ days"
> **SO THAT** my morning starts with the attendance issues that need me, not by remembering to check.

---

## 7. Functional requirements

### 7.1 Phase A — Search (`FR-SEARCH-*`)

- **FR-SEARCH-01** — New page at `/staff/attendance/search`. New API at `/api/staff/attendance-search` (GET, filters as querystring; POST permitted for very long filter payloads).
- **FR-SEARCH-02** — Filters: staff (multi-select), department (multi-select), site (multi-select), project (multi-select), date range (preset chips: Today / Yesterday / This week / Last week / This month / Last month / Custom), day-of-week multi-select, exception type multi-select (late, early-out, geo-mismatch, missing-selfie, missing-clockout, no-show), lateness threshold (minutes), only-with-OT toggle, only-Sunday/holiday toggle, only-active-staff toggle.
- **FR-SEARCH-03** — Aggregate strip at the top of the result table shows: rows-matched, total hours, total OT hours, total wage cost, distinct-staff count. Recomputed server-side per query.
- **FR-SEARCH-04** — Result table columns: date, staff, dept, site, clock-in, clock-out, hours, OT, exception flags, wage_amount. Sortable by date desc (default), date asc, hours desc, OT desc, lateness desc.
- **FR-SEARCH-05** — Drill-through on a staff name → that staff's profile page filtered to the same date range. Drill-through on a date → opens that day's full timeline modal (already exists for Today page).
- **FR-SEARCH-06** — Pagination: server-side, page size 50, with a "Load all matching (max 5 000)" override that warns above 1 000 rows.
- **FR-SEARCH-07** — XLSX export of the current filter result via `/api/staff/attendance-search/export?format=xlsx`. CSV button next to it. Both exports honour the active filters and the user's scope (no client-side filter trickery to escape scope).
- **FR-SEARCH-08** — Scope enforcement: `super_admin` and `admin` ALWAYS receive org-wide data, regardless of any `staff_id` linkage on their user record. Manager / site_supervisor / project_manager are narrowed by the existing `supervisorScope` helper.
- **FR-SEARCH-09** — RBAC: requires new permission `people.staff.attendance.search`. Cascades from parent `people.staff` for super_admin/admin. Manager/supervisor roles get it via existing inherited grants on `people.staff.attendance.*`.
- **FR-SEARCH-10** — All filters round-trip through the URL querystring so a search result is a shareable link (within scope; the recipient still gets data filtered to *their* scope).
- **FR-SEARCH-11** — Performance budget: 95th-percentile server time < 800 ms for any single-month query across full org (~50 staff). Index review required (see §13 risks).
- **FR-SEARCH-12** — Empty-state copy: distinguishes "no rows match your filters" from "scope returned zero staff" (helps a supervisor realise they have no people, vs simply no late arrivals).
- **FR-SEARCH-13** — Date-range guard: queries spanning more than 365 days get a confirm prompt (prevents accidental whole-history scans).
- **FR-SEARCH-14** — Timezone: all date filters interpreted as SAST (Africa/Johannesburg). Cross-month boundaries computed in SAST, not UTC.

### 7.2 Phase B — Saved Filters (`FR-PRESET-*`)

- **FR-PRESET-01** — New table `attendance_search_presets` (see §10).
- **FR-PRESET-02** — `Save current as preset` button on Search page; prompts for a name (≤ 60 chars) and an "set as default" checkbox.
- **FR-PRESET-03** — Preset list lives in a dropdown next to the filter bar; loading a preset replaces the active filters and updates the URL.
- **FR-PRESET-04** — `Delete` and `Rename` actions on each preset row; deleting the current default falls back to the global default (`{ dateRange: 'thisWeek' }`).
- **FR-PRESET-05** — Presets are **per-user only**; not shareable, not visible to other users. Locked decision.
- **FR-PRESET-06** — Default preset auto-loads on Search-page open; can be unset (one-click "Clear default").
- **FR-PRESET-07** — RBAC: writing presets requires `people.staff.attendance.search`; reading is implicit on the same key. No new permission required for B.

### 7.3 Phase C — Reports (`FR-REPORT-*`)

Each report follows the same shape — input filters, output columns, export. Reports live at `/staff/attendance/reports/<slug>`. The reports index `/staff/attendance/reports` is a tile grid with the seven P1 reports.

#### 7.3.1 Monthly per-staff totals — `monthly-totals`

- **FR-REPORT-MT-01** — Inputs: month (defaults to last completed month), dept multi-select (optional), site multi-select (optional).
- **FR-REPORT-MT-02** — Columns: staff_id, full_name, dept, site, days_worked, total_hours, OT_hours, exceptions_count, late_count, no_show_count, total_wage.
- **FR-REPORT-MT-03** — Export: XLSX default; CSV button. Filename: `pulse-monthly-{YYYY-MM}.xlsx`.

#### 7.3.2 Late arrivals — `late-arrivals`

- **FR-REPORT-LA-01** — Inputs: date range (default last 30 days), threshold minutes (default 5), dept/site multi-select.
- **FR-REPORT-LA-02** — Columns: date, staff, dept, scheduled_start, actual_clock_in, lateness_min, exception_id (linkable).
- **FR-REPORT-LA-03** — Export: XLSX default; CSV button.

#### 7.3.3 Geo-mismatch — `geo-mismatch`

- **FR-REPORT-GM-01** — Inputs: date range (default last 30 days), dept/site multi-select.
- **FR-REPORT-GM-02** — Columns: date, staff, clock-in lat/lng, nearest site, distance_m, site_geofence_radius_m, exception_id, has_correction.
- **FR-REPORT-GM-03** — Export: XLSX default; CSV button.

#### 7.3.4 OT trend — `ot-trend`

- **FR-REPORT-OT-01** — Inputs: dept multi-select (optional), staff multi-select (optional). Always last 12 weeks.
- **FR-REPORT-OT-02** — Columns: staff, dept, w-11, w-10, ... w-0, total_OT_hours, sparkline (rendered in XLSX as inline image; CSV omits sparkline column).
- **FR-REPORT-OT-03** — Export: XLSX default (with sparkline); CSV button (numeric only).

#### 7.3.5 Department rollup — `dept-rollup`

- **FR-REPORT-DR-01** — Inputs: date range, optional dept multi-select.
- **FR-REPORT-DR-02** — Columns: dept, headcount, total_hours, OT_hours, avg_hours_per_head, exceptions_count, total_wage.
- **FR-REPORT-DR-03** — Export: XLSX default; CSV button.

#### 7.3.6 Holiday + Sunday work — `bcea-premium`

- **FR-REPORT-BC-01** — Inputs: date range, dept/site multi-select. Public-holiday source: existing SA public-holiday list in DB (assumed; flag for confirm in §14).
- **FR-REPORT-BC-02** — Columns: date, day_type (Sunday / public-holiday name), staff, dept, hours_worked, BCEA_premium_rate, premium_amount.
- **FR-REPORT-BC-03** — Export: XLSX default; CSV button.

#### 7.3.7 Wage cost rollup — `wage-cost`

- **FR-REPORT-WC-01** — Inputs: date range, group-by (dept | site | project | none).
- **FR-REPORT-WC-02** — Columns vary by group-by. Always: total_wage, OT_wage, headcount, hours.
- **FR-REPORT-WC-03** — Export: XLSX default; CSV button.

#### 7.3.8 Common report behaviours

- **FR-REPORT-COM-01** — All reports honour `supervisorScope` for non-admin roles; super_admin/admin always see org-wide.
- **FR-REPORT-COM-02** — Run telemetry: each report run logs `(user_id, report_slug, params_json, row_count, duration_ms)` to the existing telemetry sink for the success-metric dashboard (§11).
- **FR-REPORT-COM-03** — Reports requested with > 50 000 rows return a 413 with a friendly UI message asking the user to narrow the range.

### 7.4 Phase D — Bulk Actions (`FR-BULK-*`)

- **FR-BULK-01** — Selection: row checkboxes on Search results, Week view, Corrections queue. "Select all matching" option above the table.
- **FR-BULK-02** — Bulk-lock action available from Week view: bulk-locks the selected (staff, week) pairs.
- **FR-BULK-03** — Bulk correction-request action available from Search results: requests correction on the selected exception rows.
- **FR-BULK-04** — Confirm modal: shows selection summary ("32 rows across 18 staff in 3 sites"), required free-text reason note (≥ 10 chars), confirm + cancel.
- **FR-BULK-05** — Server-side scope check on every staff in the selection: any staff outside the user's scope returns a 403 for the whole batch (no partial commits).
- **FR-BULK-06** — One audit row per affected staff in the existing audit sink: `(actor_user_id, action, target_staff_id, target_week_or_date, reason_note, batch_id, created_at)`. The shared `batch_id` makes the action traceable as a single intent.
- **FR-BULK-07** — Bulk lock requires new permission `people.staff.attendance.bulk_lock` (super_admin/admin only). Bulk correction request reuses `people.staff.attendance.corrections`.

### 7.5 Phase E — Action Items integration (`FR-ACTION-*`)

- **FR-ACTION-01** — `/action-centre` adds three Pulse-sourced cards: Pending Corrections, Open Exceptions, No-show Alerts.
- **FR-ACTION-02** — Pending Corrections card: shows count of corrections in `pending` state within the user's scope; clicking deep-links to `/staff/attendance/corrections` filtered to `status=pending`.
- **FR-ACTION-03** — Open Exceptions card: shows count of unresolved exceptions in the last 7 days within the user's scope; clicking deep-links to `/staff/attendance/search?exception=any&dateRange=last7d`.
- **FR-ACTION-04** — No-show Alerts card: shows count of active staff with zero clock-in in the last 3 calendar days; clicking deep-links to a Search preset; threshold N=3 is server-config, not UI-configurable in this phase.

---

## 8. Non-functional requirements

### 8.1 Performance

- **NFR-PERF-01** — Search 95p < 800 ms for a one-month, full-org filter; < 250 ms for a one-week filter.
- **NFR-PERF-02** — Each report 95p < 3 s end-to-end to first row; XLSX assembly < 5 s for 5 000-row reports.
- **NFR-PERF-03** — Saved filter load < 50 ms (one indexed read on `attendance_search_presets`).
- **NFR-PERF-04** — Bulk-lock commit (50 staff × 1 week) < 2 s server-side.

### 8.2 Reliability

- **NFR-REL-01** — Each phase deployable independently; nothing in A–E breaks the existing 12 admin endpoints or their UI.
- **NFR-REL-02** — Bulk operations are all-or-nothing per batch (one transaction per action). Pre-flight scope check prevents 207 multi-status complications.
- **NFR-REL-03** — Reports degrade gracefully on partial data — a missing `wage_amount` is rendered as 0 and counted in a "rows with missing wage" footer, not a 500.

### 8.3 Security & POPIA

- **NFR-SEC-01** — Every new endpoint mounted with `withPermission('people.staff.attendance.search')` (or stricter where called out per FR).
- **NFR-SEC-02** — POPIA: this is internal HR data on Velocity employees. Retention follows the existing payslip rule (7 years from period-end, per PRD-040 §10), pending the same legal review.
- **NFR-SEC-03** — Selfie URLs in any Pulse view render only via the existing audited `/api/staff/attendance-selfie` endpoint. No raw `/storage/...` paths exposed in JSON.
- **NFR-SEC-04** — Server-side scope filter on every query — never trusts a client-supplied `staff_id` or `dept_id` that is outside the user's scope.
- **NFR-SEC-05** — Audit log is append-only; no UI delete path on bulk-action audit rows.

### 8.4 Accessibility

- **NFR-A11Y-01** — WCAG AA contrast on all new surfaces (Search filter chips, Reports tile grid, Bulk confirm modal).
- **NFR-A11Y-02** — Tap targets ≥ 48 × 48 CSS px on mobile breakpoints (super-admins occasionally use Pulse from a phone).
- **NFR-A11Y-03** — Keyboard navigation across the Search results table: arrow keys move row focus, Enter opens drill-through, Space toggles row selection in bulk-mode.
- **NFR-A11Y-04** — Screen-reader labels on all filter chips and on every Reports tile.

### 8.5 Observability

- **NFR-OBS-01** — Stderr mirror pattern extended to all new endpoints: `attendance-search`, `attendance-search/export`, `attendance-presets`, `attendance-reports/<slug>`, `attendance-bulk-lock`, `attendance-bulk-correction-request`. Silent failures must be grep-able in `/var/log/fibreflow-production.error.log`.
- **NFR-OBS-02** — Report-run telemetry (FR-REPORT-COM-02) feeds the success-metric dashboard.
- **NFR-OBS-03** — Bulk-action audit rows are queryable from the standard admin audit viewer.

---

## 9. Dependencies

### 9.1 Existing tables (read)

- `attendance_entries` — clock events
- `attendance_exceptions` — late, geo-mismatch, no-show, missing-selfie flags
- `attendance_corrections` — pending / approved / rejected correction records
- `daily_summaries` — pre-aggregated per-staff per-day totals (primary source for Search and most reports)
- `attendance_weekly_locks` — payroll-week lock state (write target for Phase D)
- `staff` — directory, department, role, hire_date, termination_date
- `vehicle_assignments` — staff ↔ vehicle (used by Cartrack-divergence backlog report)
- `sites` — geofence radius and centroid (used by geo-mismatch report)

### 9.2 Existing helpers

- `supervisorScope(userId)` — returns `{ staffIds, deptIds, siteIds, projectIds }` for scope-narrowed roles. **Pulse must NOT call this for super_admin/admin** (locked decision §3.2 → org-wide).
- `attendance-overview` aggregator — re-used as the basis for the Department rollup report.
- Existing XLSX export helper (per the `excel-export` skill convention).

### 9.3 Existing UI

- `AttendanceNav.tsx` + `attendanceNavConfig.ts` — extended with two new entries (Search, Reports).
- Existing Today and Week pages — gain row-selection checkboxes in Phase D.

### 9.4 Existing infrastructure

- Single shared Supabase (Velocity, port 5437) — both dev and prod hit the same DB (memory: `project_db_supabase`).
- Worktree mandatory per `feedback_always_use_worktree`.
- Auto-migrations work post-#1485 (`schema_migrations` tracker backfill).

---

## 10. Schema additions

Exactly one new table in this entire PRD. No other schema changes. Phase A ships with **no migration**.

### 10.1 `attendance_search_presets` (Phase B)

```sql
CREATE TABLE attendance_search_presets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  filter_json  jsonb NOT NULL,
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attendance_search_presets_user_idx
  ON attendance_search_presets (user_id, updated_at DESC);

-- Only one default per user
CREATE UNIQUE INDEX attendance_search_presets_one_default_per_user
  ON attendance_search_presets (user_id) WHERE is_default = true;
```

- `filter_json` shape mirrors the Search querystring (staff IDs, dept IDs, site IDs, project IDs, dateRange preset name + custom from/to, exception types, lateness threshold, day-of-week mask, only-OT, only-Sunday-holiday, only-active).
- `filter_json` carries a version field (`{ "v": 1, ... }`) so Phase A shapes can be migrated forward without deleting old presets.
- Migration sequence number assigned at implementation time (next available after 329).

### 10.2 New permissions

| Key | Cascades from | Grants |
|---|---|---|
| `people.staff.attendance.search` | `people.staff.attendance` | super_admin, admin, manager, site_supervisor, project_manager |
| `people.staff.attendance.bulk_lock` | `people.staff.attendance.locks` | super_admin, admin (only) |

All other Pulse surfaces reuse the existing keys: `people.staff.attendance.manage`, `people.staff.attendance.corrections`, `people.staff.attendance.locks`, `people.staff.attendance.cartrack_mapping`. Parent `people.staff` continues to cascade.

---

## 11. Success metrics

| Metric | Baseline | Target (3 months post-launch) |
|---|---|---|
| Daily Search-page sessions (unique user/day) | 0 | ≥ 8 / weekday across admin users |
| Monthly report runs (P1 reports combined) | 0 | ≥ 80 / month |
| Time-to-find-late-arrival (HR-self-reported) | ~10 min via Excel | < 30 s in Pulse |
| Bulk locks per pay cycle (% of locks via bulk vs single) | 0% | > 80% by month 3 |
| Saved-filter usage | 0 | ≥ 60% of Search sessions load a preset |
| Action Items click-through to Pulse | 0 | ≥ 30% of admin centre sessions follow a Pulse card |

Telemetry sources: Search page hits via standard page-view telemetry, report runs via FR-REPORT-COM-02, bulk-vs-single via the audit sink, presets via Search-page state.

---

## 12. Rollout plan

| Phase | Scope | Duration | Migration? | Independently shippable |
|---|---|---|---|---|
| **A — Search** | New page, new endpoint, filter chips, aggregate strip, drill-through, XLSX/CSV export, scope enforcement, URL round-trip. Tab rename. | 3–4 days | No | Yes |
| **B — Saved filters** | `attendance_search_presets` table, save/load/delete/star-default, default auto-load. | 1–2 days | One (additive) | Yes |
| **C — Reports** | Reports index page, seven report pages, common XLSX/CSV export, run telemetry. | 4–5 days | No | Yes (each report can land in its own PR if needed) |
| **D — Bulk actions** | Selection on Search/Week/Corrections, confirm modal with reason, server-side scope pre-flight, audit-row-per-staff, bulk_lock permission. | 2 days | No | Yes |
| **E — Action Items** | Three cards on `/action-centre`, deep-links into Pulse. | 1 day | No | Yes |

**Total**: 11–14 working days. Each phase is its own PR (or PR set). Phase A ships without any migration — fully backwards compatible.

**Rollout order is locked**: A → B → C → D → E. C can begin in parallel with B once A is in main, but does not depend on B.

---

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Search query performance on 50+ staff × 12+ months of `daily_summaries` and `attendance_exceptions` | Medium | Medium | Index review pre-Phase-A on `(staff_id, date)` and `(date, exception_type)`; add covering indexes if 95p budget breached. Date-range guard at 365 days. |
| Bulk lock destructive without staged confirm | Medium | High | Mandatory selection-summary modal + reason note + per-staff audit row + transactional commit. No "are you sure?" alert-only confirm. |
| Cartrack vs clock divergence report (backlog C2) depends on stable `cartrack_id` mapping; Master_2026 has known quirks (`feedback_master2026_excluded`) | Medium | Low (not in P1) | Backlog only. When P1 expands, exclude Master_2026 site or surface a "coverage caveat" footer. |
| Cross-month timezone drift (UTC vs SAST boundary at 22:00 UTC) | Medium | Medium | All filters and report bins computed in SAST per `feedback_timezone_sast`. Explicit unit tests on month-boundary edge. |
| XLSX export memory pressure on large reports | Low | Medium | 50 000-row server cap (FR-REPORT-COM-03); stream the file rather than build in memory once row counts exceed 5 000. |
| Saved filter `filter_json` shape drift between Phase A and later phase | Low | Low | Version field inside `filter_json` (`{ "v": 1, ... }`) so Phase A shapes can be migrated forward. |

---

## 14. Open questions

1. **Public-holiday source** — does the DB currently carry the SA public-holiday list, and is it maintained year-on-year? If not, FR-REPORT-BC-01 needs an upstream loader. (HR / data eng)
2. **POPIA retention** — same legal review as PRD-040 §10. If legal lands on a number other than 7 years, the Pulse data lifecycle aligns with whatever is decided there.
3. **`wage_amount` definition** — is `wage_amount` already net of OT premium, or is OT premium computed downstream? Affects FR-REPORT-WC-02 and the BCEA premium report. (Finance)
4. **Action Items no-show threshold N** — locked to 3 days for Phase E; should it be UI-configurable? Out of scope for E1, listed here as a follow-up.
5. **Sharing presets between users** — locked NO for now (per Hein). Re-open if managers ask.

---

## 15. References

- PRD-040 — `docs/PRDs/PRD-040-unified-staff-portal.md` (sister PRD for the staff phone portal; this PRD is the admin counterpart).
- `attendanceNavConfig.ts` — current Pulse sub-nav source.
- `src/components/attendance/AttendanceNav.tsx` — ModuleNav component.
- PR #1484 — migration 329 (legacy `vf.fibreflow.app` → `/storage/...` URL rewrite).
- PR #1485 — `schema_migrations` tracker backfill (auto-migrations now reliable).
- PRs #1474–#1487 — receipts feature shipped 2026-04-25 (precedent for bulk-action audit shape, EntitySearch typeahead pattern reusable in Search filter bar).
- Memories: `feedback_always_use_worktree`, `feedback_timezone_sast`, `feedback_master2026_excluded`, `reference_storage_api_nested_path_patch`, `project_db_supabase`.

### Phase C2 backlog — candidate follow-up reports (not specced in this PRD)

1. Early departures
2. Missed clock-outs
3. Attendance scorecard (composite: % on-time, % full days, exception count → score)
4. Cartrack vs clock divergence
5. Pending corrections aging
6. No-shows (active staff with no clock-in for ≥ N days, configurable N)
7. Selfie consent status (POPIA compliance view)

These will be PRD'd separately once Phase C P1 is in production for ≥ 4 weeks and HR has filed real demand.
