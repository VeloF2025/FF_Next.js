# Attendance (Pulse) — RBAC endpoint → permission map

Single source of truth for which permission gates each `/staff/attendance` API,
where that permission is seeded, and which endpoints layer a per-staff
**supervisor-scope** check on top of the RBAC gate.

> Maintenance: when you add or re-gate an attendance API, update this table in
> the same PR. Keys are seeded by the listed migration; grants live in
> `role_permissions`.

## Endpoint → permission

| API route (`pages/api/staff/`) | Permission key | Action | Seed migration | Per-staff scope? |
|---|---|---|---|---|
| `attendance-roster` | `people.staff.attendance.manage` | view | 310 | — |
| `attendance-overview` | `people.staff.attendance.manage` | view | 310 | scoped (supervised staff) |
| `attendance-week` | `people.staff.attendance.manage` | view | 310 | — |
| `attendance-export` | `people.staff.attendance.manage` | view | 310 | — |
| `attendance-selfie` | `people.staff.attendance.manage` | view | 310 | **scoped (#1991)** |
| `attendance-entries` | `people.staff.tabs.attendance` | view | 310 | scoped (`authorizedToSuperviseStaff`) |
| `attendance-manual-entry` | `people.staff.attendance.corrections` | edit | 320 | scoped |
| `attendance-corrections` | `people.staff.attendance.corrections` | view | 320 | scoped (list) |
| `attendance-corrections-review` | `people.staff.attendance.corrections` | edit | 320 | scoped |
| `attendance-weekly-locks` | `people.staff.attendance.locks` | view (+ per-action create/edit) | 320 | system-wide |
| `attendance-bulk-lock` | `people.staff.attendance.bulk_lock` | create | 332 | scoped (`assertScopeOver`) |
| `attendance-cartrack-mapping` | `people.staff.attendance.cartrack_mapping` | view (+ per-action edit) | 320 | fleet-level |
| `attendance-search` | `people.staff.attendance.search` | view | 330 | scoped (intersect with allowed) |
| `attendance-search-export` | `people.staff.attendance.search` | view | 330 | scoped |
| `attendance-presets` | `people.staff.attendance.search` | view | 330/331 | own presets (Search page) |
| `attendance-pulse-signals` | `people.staff.attendance.search` | view | 330 | scoped (Action Centre widget) |
| `attendance-report` | `people.staff.attendance.manage` | view | 310 | scoped — **#1992 (was `…search`)** |
| `attendance-report-export` | `people.staff.attendance.manage` | view | 310 | scoped — **#1992 (was `…search`)** |

## Role grants (view), from the seed migrations

| Permission | super_admin | admin | manager | site_supervisor | project_manager | qa_manager | others |
|---|---|---|---|---|---|---|---|
| `…attendance.manage` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| `…tabs.attendance` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | viewer ✓ |
| `…attendance.search` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `…attendance.bulk_lock` (create) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `…attendance.corrections` / `.locks` / `.cartrack_mapping` | ✓ | ✓ | see migration 320 | | | | |

## Notes

- **`search` vs `manage`.** `search` adds `project_manager` over `manage`. Read-only
  cross-staff list/search (`attendance-search`, `-search-export`, `-presets`,
  `-pulse-signals`) sits on `search`. Anything that exposes **wage / BCEA money**
  (`attendance-report`, `-report-export`) sits on the stricter `manage` (#1992).
  Switching the report endpoints intentionally drops `project_manager` from HR
  reports while keeping them on the search list.
- **Presets and pulse-signals stay on `search`** because they back the Search page
  and the Action Centre widget respectively — not the financial reports.
- **Supervisor scope** (`src/services/attendance/supervisorScope.ts`) is a second
  gate *on top of* RBAC: `super_admin`/`admin` bypass; managers/supervisors are
  limited to the staff they supervise. The selfie endpoint now enforces it (#1991).
- **Seed verification.** Keys are defined in: `310` (manage, tabs.attendance),
  `320` (corrections, locks, cartrack_mapping), `330` (search), `332` (bulk_lock).
  All `ON CONFLICT DO NOTHING`, so the seeds are idempotent and re-runnable.
