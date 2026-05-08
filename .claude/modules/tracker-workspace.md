# Tracker Workspace — full reference

The unified per-project tracker workspace that replaces the multi-sheet Excel
project trackers (Lawley, Mohadin, Mamelodi, …).

## Spec & plans
- Spec: `docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md`
- Plan 1.0a (this plan): `docs/superpowers/plans/2026-05-08-tracker-workspace-1.0a-schema-foundation.md`

## Database

### Canonical PON entity — `pon_stage_tracking`
- Existing table (mig 179, 232) extended in mig 335 with `olt_port`, `hld_pon`,
  `z_pon`, `scope_string`, `sign_ups`, `homes_po`, `homes_recon`, `available`,
  `pct_original`, `pct_recon`.
- Sourced from 1Map (`/api/onemap/sync-stages`) + OES (`oes_activations`) +
  manual edits routed through the workspace UI (plan 1.0b).
- Unique key: `(project_id, zone_no, pon_no)`. `pon_no` is the **zone-level**
  PON number — same as the Excel `Z PON` column.

### Manual overrides — `pon_manual_overrides`
- Mig 336. 1:1 with `pon_stage_tracking` via primary key `pon_stage_id`.
- Holds free-text fields with no source feed: `blockage`, contractor names,
  optical type/splitter, ATP submitter notes.
- **Lazy insert:** a row only exists when at least one field has been edited.
  All joins from `pon_stage_tracking` MUST use `LEFT JOIN`.

### Audit log — `pon_change_log`
- Mig 337 creates the table; mig 339 corrects the FKs to `ON DELETE SET NULL`
  and drops `chk_pon_or_drop` so audit history survives parent deletion.
- Append-only at the application layer.
- `source` ∈ {`ui`, `1map`, `oes`, `nokia`, `sp_sync`, `import`, `migration`}.
- Resolved Q4 (cascade vs set null): SET NULL — preserves orphaned history
  while still allowing parent deletion. Anomalous rows surface as
  `pon_stage_id IS NULL` joins.

### Master tracker — existing `master_tracker` table
- Already exists with the 73-column Excel shape (no view created).
- Lawley snapshot importer (plan 1.0d) inserts rows; workspace UI reads/writes
  rows directly (plan 1.0c).
- Mig 338 was unnecessary — Task 4's audit confirmed the existing schema
  matches the spec exactly.
- `master_tracker.project_id` is `text` (storing uuid strings) — application
  code casts at the boundary.

## Free wins (already on prod, reuse don't rebuild)
- `v_pole_completion` + `v_pon_pole_progress` (1,713 rows) — per-pole and
  per-PON completion aggregations. Use for the home dashboard (plan 1.0c).
- `pon_boundaries` (1,617 rows) — PON polygon geometries. Use for the C-lens
  map (plan 1.2).

## Legacy tables (parallel-cutover window)
| Table | Status | Retirement |
|-------|--------|-----------|
| `pon_tracker` | Dormant on prod (1 test row). Not referenced by new code. | Drop in 1.0c with the legacy UI. |
| `sp_pon_tracker` | SharePoint cron continues writing; new workspace never reads | Archive in 1.2 |
| `sp_project_summary` | Replaced by server-computed rollup of `pon_stage_tracking` | Drop in 1.2 |
| `sp_tracker_config` | Retire with the SP cron | Drop in 1.2 |
| `sharepoint_tracker_pole` | 4,965 rows of SP-synced pole data | Snapshot to `_archive_*` then drop in 1.2 |
| `sharepoint_tracker_home` | 0 rows, dormant | Drop in 1.2 |

## Known invariants
- `pon_stage_tracking.pon_no` is the zone-level PON number (= Excel `Z PON`).
- `pon_stage_tracking.hld_pon` is project-level, not unique by itself.
- Excel "PON STATUS" column maps to `pon_stage_tracking.overall_stage`
  (`activation` ≈ ACTIVE, anything else ≈ NOT ACTIVE).
- Master Tracker pole columns are denormalised in Excel (blank on subsequent
  drops sharing a pole). `master_tracker` rows mirror that exactly so the
  handover xlsx export (plan 1.0d) is a faithful round-trip.
- `master_tracker.project_id` and `pon_tracker.project_id` are `text`; all
  other tables use `uuid`. Cast at boundaries.

## Migration runner caveat
At the time of plan 1.0a's execution, `npm run db:migrate` was failing on a
pre-existing migration 277 issue unrelated to the tracker workspace. The
1.0a migrations were applied directly with `psql -f` instead. The runner
issue is separate tech debt and does not affect tracker-workspace work.
