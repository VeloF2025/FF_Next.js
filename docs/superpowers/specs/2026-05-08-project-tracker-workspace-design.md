# Project Tracker Workspace — Design Spec

- **Date:** 2026-05-08
- **Author:** Hein + Claude (brainstorm)
- **Status:** Draft — amended 2026-05-08 after live DB audit (see §3.4)
- **Branch:** `spec/tracker-redesign`

---

## 1. Why

The Velocity Fibre project trackers (Lawley, Mohadin, Mamelodi, etc.) live as multi-megabyte Excel workbooks with 11+ sheets, 12 M cells, 220 k formulas, and three different sync paths into FibreFlow. That layout has accumulated real problems:

- **Three parallel PON-tracker tables** in the database (`sp_pon_tracker`, `pon_tracker_entries`, `pon_stage_tracking`) with overlapping columns and unclear ownership.
- **Two parallel API stacks** — pages-router + `pg.Pool` (the canonical one per CLAUDE.md) and a newer app-router stack on the deprecated Neon shim, both reading and writing the same data.
- **Two parallel UI sets** — `src/modules/tracker/` and `src/modules/projects/tracker/` — each partial, neither the obvious answer for "open the tracker for project X".
- **The Excel is still source of truth** for daily PM operations: stage gates, daily activations, blockages, monthly targets. Updates happen in Excel and are pulled into FF on a SharePoint cron.
- **The supporting feeds already exist** in FF — 1Map sync, Nokia OES activation feed, SOW imports, daily progress endpoints — but no single workspace ties them together.

The goal is one interactive per-project tracker workspace inside FibreFlow that fully replaces the Excel workbook as the source of truth for PMs, Ops Leads, QA, and Activation leads.

## 2. Locked decisions (from brainstorm)

| # | Decision | Source |
|---|----------|--------|
| Q1 | FF becomes single source of truth. Excel is import-once + report-out only — no longer authoritative after cutover. | brainstorm |
| Q2 | v1 scope = whole workbook: PON tracker + Master tracker + ingestion + rollups + handover export. | brainstorm |
| Q3 | Primary users = PM + Ops Lead + QA (multi-role office team). RBAC and lane-based views per role. | brainstorm |
| Q4 | **Soft cutover with snapshot import.** v1 imports a frozen Lawley snapshot once. SP cron + FF run in parallel for 2–3 weeks for cross-check. After parallel period, Excel is retired and SP cron disabled. | brainstorm |
| L1 | Canonical PON entity = **`pon_stage_tracking`** (existing, 1Map+OES sourced, has full pipeline). Extended with manual-override columns. | data audit |
| L2 | Master tracker = **denormalised view `vw_master_tracker`** joining drops × sow_poles × pon_stage_tracking × oes_activations × contractor_invoices × onemap_*. Edits route to owning table. | data audit |
| L3 | API stack standardised on **pages-router + `pg.Pool`**. Existing app-router tracker endpoints rewritten, not extended. | CLAUDE.md guidance |
| L4 | New UI lives under **`src/modules/projects/tracker-workspace/`**. Both legacy UI sets stay available behind a feature flag during cutover, then archived. | brainstorm |
| L5 | Layout = **D (dashboard hub) home + B (phase wizard) navigator + A (dense grid) editing + C (map) lens**. Phased: v1.0 ships D + A; v1.1 adds B; v1.2 adds C and finalises cutover. | brainstorm |

## 3. Domain model

### 3.1 Hierarchy

```
Project (LAWLEY)
└── Phase (1, 2, …)             — campaign / wave
    └── Zone (1…n)
        └── HLD PON / Z PON      — design-time PON identifier
            └── PON / OLT Port   — runtime identifier (LAW.FTS.16.AGG.DM.MH.A004-OLT.01.C1P1)
                └── Pole         — LAW.P.A002, LAW.P.A043…
                    └── Drop     — DR1737348, DR1738468… ← Master tracker row
```

A PON is a first-class entity. A Pole belongs to one PON. A Drop belongs to one Pole and one PON. Phase and Zone are properties of the PON, not separate hierarchies.

### 3.2 Stage pipeline (per PON)

```
Permissions → Poles Planted → CWC → Optical → ATP → Activation → Maintenance → Complete
```

Stage definitions match the existing `pon_stage_tracking.overall_stage` constraint. Each stage has `_total`, `_complete`, `_first_date`, `_last_date`, `_target_date` fields. **Overall stage = the latest stage that is 100% complete.**

### 3.4 Live-DB audit (added 2026-05-08, supersedes §1 inventory)

The §1 inventory was assembled from migration files in the repo. A live `\dt` audit against the shared dev+prod DB on 2026-05-08 09:36 SAST revealed the real state — meaningfully different. **Use this section, not §1, when reasoning about what already exists.**

**Tables and views actually present:**

| Object | Rows | Status |
|--------|------|--------|
| `pon_stage_tracking` | exists (small) | Canonical PON entity. Spec keeps this. |
| `pon_daily_log` | exists | Daily activity log. Spec keeps this. |
| `project_monthly_targets` | exists | Spec keeps this. |
| `pon_tracker` | **1 row (test data)** | Same column shape as the `pon_tracker_entries` migration file but renamed in prod. `project_id` is `text` (storing uuids as strings). Treat as deprecated — not retained beyond 1.0a. |
| `pon_tracker_entries` | **does not exist** | Migration file in repo was never applied. Spec mentions are obsolete. |
| `master_tracker` | **0 rows, 73-col schema** | Already-built table with the exact column shape of the Excel `LAWLEY MASTER TRACKER` sheet. `project_id` is `text`. Empty but ready to populate. |
| `pon_boundaries` | **1,617 rows** | PON polygon shapes (geom + geojson). Reuse for the C-lens map (v1.2). |
| `v_pole_completion` | view, sources `pole_completion` | Computes per-pole completion across civil/optical/stringing disciplines with step-key granularity. Reuse for QA + dashboard. |
| `v_pon_pole_progress` | view, **1,713 rows** | Aggregates `v_pole_completion` to PON level. Reuse for the home dashboard. |
| `tracker_selectlists` | 31 rows | SelectList admin source. Keep, no change. |
| `sp_pon_tracker` / `sp_project_summary` / `sp_tracker_config` | exists | SharePoint sync targets. Plan unchanged: parallel-cutover read-only, retire in 1.2. |
| `sharepoint_tracker_home` | 0 rows | Dormant SP sync target. Note for 1.2 archive. |
| `sharepoint_tracker_pole` | **4,965 rows** | Live SP sync target with `raw_data jsonb`. Worth preserving in 1.2 archive (don't drop without snapshot). |
| `onemap.drops` / `onemap.poles` / `onemap.pons` (634 rows) / `onemap.zones` / `onemap.projects` / `onemap.transactions` / `onemap.sync_log` / `onemap.photo_downloads` | exists | OneMap raw-import schema. Read-only feeders. Spec unchanged. |
| `drops` (`public`) | exists, project_id is uuid | Row source for master tracker. |
| `sow_poles` | exists, has `pon_no`, `zone_no` | Join source. |
| `oes_activations` | exists | Nokia/OES feed. |
| `contractor_invoices` | exists | Billing join. |

**Free wins:** `v_pole_completion`, `v_pon_pole_progress`, and `pon_boundaries` already provide aggregations and geometry the spec assumed we'd build. Plans 1.0c (home dashboard) and 1.2 (map lens) consume them rather than reimplement.

**Schema heterogeneity gotcha:** `pon_tracker.project_id` and `master_tracker.project_id` are `text`; everything else uses `uuid`. The Lawley importer (plan 1.0d) writes uuids-as-text into `master_tracker.project_id` — application code must always cast at the boundary. A future cleanup migration may convert these columns to `uuid` once all writers are FF-internal.

### 3.3 Data sources per stage (from the Excel `Index` sheet)

| Stage | Source | Existing FF feed |
|-------|--------|------------------|
| Permissions | 1Map | `/api/onemap/sync-stages` → `pon_stage_tracking.permissions_*` |
| Poles Planted | 1Map / QField | `/api/onemap/sync-stages`, QField sync |
| CWC | 1Map `civil_dte` | `/api/onemap/sync-stages` |
| Optical / Splicing | Manual + 1Map sign-up | manual entry through tracker UI |
| ATP | Manual + photos | manual entry; QA approval workflow |
| Activation | Nokia OES | `/api/nokia/velocity` → `oes_activations` |
| Maintenance | Manual | manual entry |

Manual-only fields (no source feed): blockage text, civil contractor, civil rate, stringing contractor, optical contractor, optical splitter type, ATP submitter notes, monthly targets.

## 4. Database changes

### 4.1 Canonical PON table — extend `pon_stage_tracking`

Add columns for fields currently in `pon_tracker_entries` / `sp_pon_tracker` but not in `pon_stage_tracking`:

```sql
ALTER TABLE pon_stage_tracking
  ADD COLUMN IF NOT EXISTS olt_port            varchar(120),
  ADD COLUMN IF NOT EXISTS hld_pon             integer,
  ADD COLUMN IF NOT EXISTS z_pon               integer,
  ADD COLUMN IF NOT EXISTS scope_string        integer,
  ADD COLUMN IF NOT EXISTS sign_ups            integer,
  ADD COLUMN IF NOT EXISTS homes_po            integer,
  ADD COLUMN IF NOT EXISTS homes_recon         integer,
  ADD COLUMN IF NOT EXISTS available           integer,
  ADD COLUMN IF NOT EXISTS pct_original        numeric(5,4),
  ADD COLUMN IF NOT EXISTS pct_recon           numeric(5,4);
```

A separate companion table `pon_manual_overrides` carries the manual-only string fields so the stage table stays focused on numerics:

```sql
CREATE TABLE IF NOT EXISTS pon_manual_overrides (
  pon_stage_id          uuid PRIMARY KEY REFERENCES pon_stage_tracking(id) ON DELETE CASCADE,
  blockage              text,
  civil_contractor      text,
  stringing_contractor  text,
  optical_contractor    text,
  optical_splitter      text,
  optical_type          text,
  atp_submitter_notes   text,
  override_notes        text,
  updated_by            text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
```

### 4.2 Migration of legacy data (amended after §3.4 audit)

Identifier note: `pon_stage_tracking.pon_no` is the **zone-level** PON number (the Excel `Z PON` column). `pon_tracker.hld_pon` is the **project-level** HLD PON. Any future forward-port matches on `(project_id, zone_no, z_pon → pon_no)`.

1. **`pon_tracker`** (the actually-deployed table; `pon_tracker_entries` does not exist on prod) holds **1 test row**. No real production data to forward-port. Treat as deprecated; flag for retirement once any UI references are removed in plan 1.0c. Skip the bulk-forward-port script; instead the documentation in 1.0a notes that `pon_tracker` is dormant.
2. **`sp_pon_tracker`** → kept read-only during the parallel-cutover window (only the SP cron writes to it; UI never reads). After cutover, archive (rename `sp_pon_tracker` → `_archive_sp_pon_tracker`, drop the SP sync cron).
3. **`sp_project_summary`** → replaced by a server-computed rollup of `pon_stage_tracking` for the project. Drop after cutover.
4. **`sharepoint_tracker_pole`** (4,965 rows) → snapshot to `_archive_sharepoint_tracker_pole` in 1.2 before drop. Don't drop without a snapshot — that's real historical data.

### 4.3 Master tracker — use the existing `master_tracker` table (amended)

**Original spec proposed a denormalised view `vw_master_tracker`. The §3.4 audit found that `master_tracker` already exists as a real, empty, 73-column table with the exact Excel shape.** The amended approach uses that table directly:

- **Canonical row storage** is `public.master_tracker` (existing table). Do not create a duplicate view.
- The Lawley snapshot importer (plan 1.0d) inserts directly into `master_tracker`.
- The workspace UI (plan 1.0c) reads and writes `master_tracker` rows directly.
- Updates from automated feeds (1Map, OES, Nokia) propagate into `master_tracker` rows via service-layer broadcast (a per-feed handler that updates the relevant `master_tracker` rows when a `drops` / `sow_poles` / `pon_stage_tracking` / `oes_activations` row changes). The exact broadcast shape is plan 1.0b's concern.
- Plan 1.0a's responsibility is **not** creating a view; it's auditing the existing `master_tracker` schema and adding any missing columns to bring it fully aligned with the spec's column inventory.

A reference query that mimics the originally-proposed view (kept for documentation and as a fallback should we ever need an on-the-fly join):

```sql
-- Reference: the join shape that produces a denormalised master row.
-- NOT a deployed view; runtime queries hit master_tracker directly.
-- SELECT
--   d.id AS drop_id, d.project_id, d.drop_number, d.pon_no, d.zone_no,
--   d.pole_number, d.address, d.latitude, d.longitude,
--   p.pole_type, p.permission_date AS pole_permission_date, ...
--   pst.overall_stage, pst.olt_port, pmo.civil_contractor, ...
--   oa.activation_date, oa.activation_status, ...
--   ci.invoice_number AS pole_invoice_number, ci.paid_at AS pole_paid_date
-- FROM drops d
-- LEFT JOIN sow_poles p             ON p.project_id = d.project_id AND p.pole_number = d.pole_number
-- LEFT JOIN pon_stage_tracking pst  ON pst.project_id = d.project_id AND pst.zone_no = d.zone_no AND pst.pon_no = d.pon_no
-- LEFT JOIN pon_manual_overrides pmo ON pmo.pon_stage_id = pst.id
-- LEFT JOIN oes_activations oa      ON oa.drop_number = d.drop_number
-- LEFT JOIN contractor_invoices ci  ON ci.pole_id = p.id;
```

Edits in the workspace write **only** to `master_tracker`. Source-of-truth for the granular tables (`drops`, `sow_poles`, `pon_stage_tracking`, …) remains the granular tables; service-layer broadcast keeps `master_tracker` in sync after their writes. A nightly reconcile job verifies invariants (`master_tracker` row exists for every `drops` row in the project; key fields agree).

#### Original-spec view (now deprecated, kept commented for context):

```sql
-- DEPRECATED: not deployed. Use the master_tracker table instead.
CREATE OR REPLACE VIEW vw_master_tracker AS
SELECT
  d.id                  AS drop_id,
  d.project_id,
  d.drop_number,
  d.pon_no,
  d.zone_no,
  d.pole_number,
  d.address,
  d.latitude, d.longitude,
  -- pole columns (denormalised — only present on the first drop per pole)
  p.pole_type,
  p.pole_route_type,
  p.permission_date     AS pole_permission_date,
  p.installation_date   AS pole_installation_date,
  p.cwc_date            AS pole_cwc_date,
  p.contractor_id       AS pole_contractor_id,
  -- pon stage rollup
  pst.overall_stage,
  pst.cwc_complete, pst.cwc_target_date,
  pst.optical_complete, pst.optical_target_date,
  pst.activation_complete, pst.activation_target_date,
  pst.blockage,
  -- activation
  oa.activation_date,
  oa.activation_status,
  oa.olt_port_activated,
  -- billing references
  ci.invoice_number     AS pole_invoice_number,
  ci.paid_at            AS pole_paid_date
FROM drops d
LEFT JOIN sow_poles p           ON p.project_id = d.project_id AND p.pole_number = d.pole_number
LEFT JOIN pon_stage_tracking pst ON pst.project_id = d.project_id AND pst.zone_no = d.zone_no AND pst.pon_no = d.pon_no
LEFT JOIN oes_activations oa     ON oa.drop_number = d.drop_number
LEFT JOIN contractor_invoices ci ON ci.pole_id = p.id;
```

The view above is **deprecated** by §4.3's amended approach. It is kept only as documentation of the join shape — runtime queries use the `master_tracker` table.

### 4.4 Daily progress

Already implemented as `pon_daily_log` (mig 232). No schema change. The home heat-grid renders `pon_daily_log.activated` deltas for the last 30 days; the at-risk computation reads `project_monthly_targets`.

### 4.5 Audit / change history

Every write through the tracker workspace inserts a row into a new `pon_change_log` table:

```sql
CREATE TABLE IF NOT EXISTS pon_change_log (
  id          bigserial PRIMARY KEY,
  pon_stage_id uuid REFERENCES pon_stage_tracking(id) ON DELETE CASCADE,
  drop_id     uuid REFERENCES drops(id) ON DELETE CASCADE,
  field       text NOT NULL,
  old_value   text,
  new_value   text,
  source      text NOT NULL CHECK (source IN ('ui','1map','oes','nokia','sp_sync','import','migration')),
  changed_by  text,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
```

Surfaces in the PON detail drawer as a "History" tab.

## 5. APIs

All new endpoints land on the **pages-router + `pg.Pool`** stack. No new app-router routes; existing app-router tracker endpoints (`/api/tracker/[projectId]`, `/api/tracker/master/...`, `/api/tracker/selectlists`, `/api/tracker/migrate`, `/api/tracker/export/...`) are rewritten to pages-router equivalents and the app-router files deleted in v1.2.

### 5.1 Endpoints (additions / consolidations)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/projects/[projectId]/tracker/home` | Dashboard payload — KPIs, alerts, heat-grid data |
| GET | `/api/projects/[projectId]/tracker/pons` | List all PONs with stage rollup, filters: `zone`, `stage`, `blocked` |
| GET | `/api/projects/[projectId]/tracker/pon/[ponId]` | Full PON detail (rollup + manual overrides + recent daily log + change history) |
| PATCH | `/api/projects/[projectId]/tracker/pon/[ponId]` | Edit PON fields (RBAC enforced; routes writes to `pon_stage_tracking` or `pon_manual_overrides`) |
| GET | `/api/projects/[projectId]/tracker/master` | Master grid rows from `vw_master_tracker`, server-side filter/sort/page |
| PATCH | `/api/projects/[projectId]/tracker/master/[dropId]` | Edit a master row; dispatches per-field to owning table |
| POST | `/api/projects/[projectId]/tracker/import-snapshot` | One-shot Lawley xlsx → drops/poles/PONs (admin only) |
| GET | `/api/projects/[projectId]/tracker/export-handover` | Generates handover xlsx in client format |
| GET | `/api/projects/[projectId]/tracker/daily-log` | Daily log entries, used by D heat-grid + PON drawer |
| POST | `/api/projects/[projectId]/tracker/daily-log` | Add a daily log entry |

Existing endpoints kept (no change): `/api/onemap/sync-stages`, `/api/nokia/velocity`, `/api/sow/*`, `/api/sharepoint/sync-trackers` (kept running during parallel period).

### 5.2 RBAC enforcement

Field-level: each PATCH endpoint validates that the requester's role is allowed to edit the field group:

| Field group | PM | Ops Lead | QA | Activation | Director |
|-------------|----|---------:|----|-----------|----------|
| Project meta (targets, blockage) | RW | R | R | R | R |
| Civils stage fields | RW | RW | R | R | R |
| Optical stage fields | RW | RW | R | R | R |
| QA approvals (`cwc_qa_approved`, `atp_qa_approved`) | R | R | RW | R | R |
| Activation fields | RW | R | R | RW | R |
| Daily log | RW | RW | RW | RW | R |
| Master row financial (invoices, rates) | RW | R | R | R | R |

Read-only fields are still visible — RBAC controls write capability, not visibility.

## 6. UI

### 6.1 Routes & layout

```
/projects/[projectId]/tracker                  ← workspace shell, defaults to "Home"
├── ?tab=home                                   D — KPIs + heat-grid + alerts
├── ?tab=stages&stage=optical                   B — phase wizard with stage filter
├── ?tab=master                                 A — denormalised grid editor
├── ?tab=pons                                   PON cards, freely filterable
├── ?tab=map                                    C — GIS lens (v1.2)
├── ?tab=imports                                SOW imports + 1Map sync status
├── ?tab=reports                                handover export, build milestones
└── ?tab=admin                                  SelectLists, monthly targets, role lanes
```

Tabs persist in the URL so links to a specific lens are shareable.

### 6.2 Component plan

```
src/modules/projects/tracker-workspace/
├── TrackerWorkspacePage.tsx           ← shell + tab routing
├── home/
│   ├── DashboardHome.tsx              ← D — KPIs + heat-grid + alerts
│   ├── HeatGrid.tsx
│   ├── KpiTile.tsx
│   └── AlertsPanel.tsx
├── stages/
│   ├── StageNavigator.tsx             ← B — top stepper
│   ├── StageLane.tsx                  ← per-stage filtered PON list
│   └── (added in v1.1)
├── master/
│   ├── MasterGrid.tsx                 ← A — replaces both legacy MasterTrackerPage and TrackerTable
│   ├── columns/                       ← column defs grouped by stage
│   └── editing/CellEditor.tsx
├── pon/
│   ├── PonDetailDrawer.tsx            ← opens from any tab
│   ├── PonDetailHeader.tsx
│   ├── PonStageProgress.tsx
│   ├── PonDailyLogPanel.tsx
│   └── PonChangeHistoryTab.tsx
├── map/                                ← C — added in v1.2
├── imports/
│   ├── SnapshotImporter.tsx
│   ├── SyncStatusPanel.tsx            ← 1Map / OES / SP cron status
│   └── SowImportLink.tsx
├── reports/
│   ├── HandoverExportButton.tsx
│   └── ReportLinks.tsx
├── hooks/
│   ├── useTrackerHome.ts
│   ├── useMasterGrid.ts
│   ├── usePonDetail.ts
│   └── usePonRoleEditing.ts            ← RBAC-aware editing
└── types/
    └── tracker-workspace.types.ts
```

`src/modules/tracker/` and `src/modules/projects/tracker/` are kept on disk during the cutover window behind a `tracker_workspace_v1` feature flag. After v1.2 ships and stabilises (~2 weeks), they are deleted.

### 6.3 Editing model

- **Optimistic updates** with toast confirmation. Server returns the canonical row; UI reconciles.
- **No row locks**. Conflict resolution: last-write-wins, but `pon_change_log` makes any conflict visible in the History tab and in a daily Slack digest for PMs.
- **Inline cell editing** for the master grid; **drawer-based form editing** for PON detail (denser layout, role-aware sections).
- **Bulk operations** (apply value to N selected PONs / drops) gated behind PM/Director.

### 6.4 Map lens (v1.2)

- PON regions rendered from `pon_boundaries.geom` (already populated, 1,617 rows — no convex-hull computation needed).
- Pole pins from `sow_poles.latitude`/`.longitude`, coloured by `pon_stage_tracking.overall_stage`.
- Click a region → PON drawer; click a pole → drop list filtered to that pole.
- Reuses the existing FF map stack (the same library already used by `src/modules/onemap/` and `src/modules/projects/pole-tracker/`). Confirm exact library when implementation begins; do not introduce a new mapping dependency.

## 7. Cutover plan

### 7.1 Phase A — Pre-cutover (during v1.0 implementation)

- SP sync cron continues. `sp_pon_tracker` and `pon_stage_tracking` populated in parallel.
- Snapshot importer is exercised against Lawley export every Friday into a `staging` namespace; deltas logged to confirm the importer captures every Excel column.

### 7.2 Phase B — Soft cutover (v1.0 ships)

- Production switches to `tracker_workspace_v1` flag = on for PMs of Lawley + Mohadin.
- SP cron remains running but is **read-only into FF** (only writes to `sp_pon_tracker`, never to canonical tables).
- For 2–3 weeks PMs use the FF workspace as primary; Excel can still be opened for cross-check.
- Daily diff job runs `sp_pon_tracker` vs `pon_stage_tracking + pon_manual_overrides` and reports any drift to a Slack channel.

### 7.3 Phase C — Hard cutover (v1.2)

- Excel becomes read-only (lock the workbook in SharePoint).
- SP cron disabled.
- `pon_tracker_entries`, `sp_pon_tracker`, `sp_project_summary` archived (renamed `_archive_*`, dropped after a 90-day retention window).
- App-router tracker endpoints deleted; legacy UI modules deleted; feature flag removed.

## 8. Handover export

Generated on demand from `/api/projects/[projectId]/tracker/export-handover`:

- **Sheet 1** — Project Summary (header + rollup KPIs).
- **Sheet 2** — PON Tracker (one row per PON, columns matching the Excel `PON Tracker(N)` layout).
- **Sheet 3** — Master Tracker (one row per Drop, full denormalised columns).
- **Sheet 4** — QA log (per-PON QA status + dates).
- **Sheet 5** — Daily progress matrix (PON × date, last 90 days).
- **Sheet 6** — Index / data dictionary.

`xlsx` library only (already in use). No formulas; values + formatting only. The Excel becomes a snapshot, never re-imported.

## 9. Phasing

### v1.0 — Foundation (4–6 weeks)

1. Schema migration: extend `pon_stage_tracking`, create `pon_manual_overrides`, create `pon_change_log`, create `vw_master_tracker`.
2. Forward-port `pon_tracker_entries` data; mark legacy tables as read-only at the application layer.
3. Pages-router endpoints: home, pons, pon detail (RW), master grid (RW), daily log (RW), import-snapshot (admin), export-handover.
4. UI: `TrackerWorkspacePage` shell + Home (D) + Master grid (A) + PON drawer + Imports + Reports tabs.
5. Snapshot importer for Lawley xlsx → drops / poles / pons.
6. Handover xlsx export.
7. Feature flag `tracker_workspace_v1`.

### v1.1 — Phase Wizard (2–3 weeks)

1. Stages tab (B) with phase stepper + per-stage filtered PON list.
2. Per-role lane filtering (RBAC-aware default views).
3. Daily log inline editor + monthly targets editor.
4. At-risk indicator + alert generation rules.
5. Bulk operations on PONs (PM-only).

### v1.2 — Map + Final Cutover (2 weeks)

1. Map tab (C) with PON regions + pole pins.
2. Disable SP sync cron; archive `sp_*` tables; delete legacy endpoints + legacy UI modules.
3. Audit log polish + change-history surfacing in drawer.
4. Drift-watch Slack digest retired.

## 10. Out of scope (explicit non-goals)

- Field-side capture (poles, photos) — already handled by QField, the `/my` PWA, and the WhatsApp bridge.
- Procurement workflows (BOQ / RFQ / PO) — already in `src/modules/procurement/`.
- New mapping infrastructure — reuse existing FF map components.
- Live collaboration (Google-docs-style multi-cursor) — out of scope; last-write-wins + change log is sufficient.
- Excel-style formula authoring — replaced by view computation + UI-rendered metrics.
- Mobile-optimised tracker UI — desktop-first; field roles use existing mobile surfaces.

## 11. Risks & open questions

| # | Risk / question | Mitigation / owner |
|---|-----------------|---------------------|
| R1 | Drift between SP cron and FF workspace during parallel period | Daily diff job → Slack; cap parallel window at 3 weeks. |
| R2 | Lawley snapshot importer misses an Excel column | Friday dry-runs into staging starting v1.0 sprint 2; column coverage tracked in the importer's test fixtures. |
| R3 | Master view query performance on 25 k drops × joins | Materialise as a `MATERIALIZED VIEW` if `EXPLAIN ANALYZE` shows > 500 ms p95; refresh on PG NOTIFY from underlying tables. |
| R4 | Existing `MasterTrackerPage` / `PonTrackerPage` users disrupted | Feature flag default = off until cutover sprint; in-app banner during parallel period. |
| R5 | Drop-→-pole pole-data denormalisation in Excel (pole columns blank on subsequent drops sharing a pole) — does Master grid replicate that? | UI shows pole columns on every drop row (cleaner). Export-handover replicates Excel's "blank on duplicates" behaviour for stakeholder familiarity. |
| Q1 | Are Mohadin and Mamelodi structured identically to Lawley? Importer assumes yes; needs validation against a Mohadin export before v1.1. | PM input. |
| Q2 | Who owns `pon_change_log` review? Ad-hoc or weekly digest? | PM team to decide before v1.1. |
| Q3 | Should "Phase" become a first-class entity (campaigns / waves) or stay a column? Current data has only `phase = 1` for Lawley. | Defer to v2; column is sufficient for v1. |

## 12. Success criteria (measurable)

- **C1.** A PM can open `/projects/[lawley]/tracker` and answer "what's blocked, what's at risk, what shipped today" in < 30 s without opening Excel.
- **C2.** Every Excel column in the Lawley `LAWLEY MASTER TRACKER` sheet is reachable in the Master grid (column-coverage test).
- **C3.** Every Excel column in `PON Tracker(N)` is reachable in the PON drawer.
- **C4.** Daily diff between `sp_pon_tracker` and `pon_stage_tracking + pon_manual_overrides` is empty for ≥ 5 consecutive days before hard cutover.
- **C5.** Handover export round-trips: open the generated xlsx in Excel, compare against the source workbook — values match for the same data points.
- **C6.** Zero new code uses the Neon shim; tracker endpoints all land on `pg.Pool`.

---

*End of spec. Implementation plan to follow via `superpowers:writing-plans`.*
