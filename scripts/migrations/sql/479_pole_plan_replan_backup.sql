-- Migration 479: backup spine for pole-plan (replan) re-imports.
--
-- Additive and idempotent: creates three new tables, touches no existing object
-- and no existing row. Safe to re-run.
--
-- NOT wrapped in BEGIN;/COMMIT; on purpose. scripts/run-pending-migrations.sh
-- applies this file as `psql -1 -c "\i <file>" -c "INSERT INTO
-- schema_migrations ..."`. Postgres does not nest transactions, so a COMMIT
-- inside the file ends psql's transaction early and lets the DDL commit while
-- its tracker row fails independently. Matches 467, 469, 471 and 472.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- A fibre design gets "replanned": the planner re-issues the whole project with
-- new pole labels, new zones and new PONs. Thembisa POP 3 is the live case.
-- FibreFlow's `public.poles` for that project is a single import from
-- 2026-02-14 (3,594 poles, labels TEM.P.G/H/I/J001-J765). The current replan
-- (`Thembisa 3 Replan.gpkg`, QFieldCloud project 5f3b962a…) carries 4,476 poles
-- under labels TEM.P.I392-I579/J732-J999/K/L/M/N/O and zones 53,63,66-77.
--
-- Only 138 labels are common to both. Joining the two plans on GEOMETRY rather
-- than label shows what actually happened: 1,287 poles are the SAME physical
-- pole (<=5 m apart) carrying a DIFFERENT label. e.g. TEM.P.G141 -> TEM.P.J950
-- at 0.0 m, zone 44 -> 69, PON 535 -> 821.
--
-- Field crews already work the new numbering. Their QA photos arrive with
-- labels that match no row in `public.poles`, so the QField ingest cannot
-- resolve a zone and the photo lands with zone_no = NULL — present in the
-- database, invisible to every zone-filtered screen. Measured 2026-08-05:
-- 98 of Thembisa POP 3's 311 QA photos unzoned, 19 of them on PON 821 alone.
-- That is the defect Johan Scott reported on 2026-08-04.
--
-- ── What this migration does (and does not) ─────────────────────────────────
-- It creates ONLY the backup spine. It imports nothing and rewrites nothing.
-- The import itself is scripts/qfield-recon/import_replan_poles.py, which is
-- dry-run by default and writes here before it touches `poles`. Splitting them
-- is deliberate:
--
--   * The replan is a MOVING TARGET — four versions were uploaded to MinIO on
--     2026-08-04 alone (latest v20260804162814-47d3016d). Freezing 4,476 INSERT
--     statements into a migration would ship a snapshot that is stale within
--     days, and would have to be re-issued as a new migration every time the
--     planner re-exports. The importer re-reads the newest version each run.
--   * Re-import is the normal case, not the exception. Other projects
--     (Etwatwa, Grabouw, Tonga, Themb'elihle) will replan too. The spine is
--     project-agnostic.
--
-- ── Reversibility ──────────────────────────────────────────────────────────
-- Every run gets a row in `pole_plan_import_runs`. Before mutating anything the
-- importer copies each affected `poles` row into `pole_plan_backup` and each
-- affected `pole_qa_photos` label/zone/PON triple into
-- `pole_qa_photo_plan_backup`. `import_replan_poles.py --rollback <run_id>`
-- restores both and marks the run 'rolled_back'.
--
-- Pole rows are stored as JSONB (`row_data`) rather than as a LIKE-cloned
-- table. `public.poles` has 38 columns and gains more over time; a cloned
-- backup table silently stops capturing any column added after this migration,
-- and the loss is invisible until a restore quietly zeroes it. jsonb_populate_record
-- against the live rowtype restores whatever was there at backup time and
-- tolerates the drift in both directions. `pole_qa_photos` is stored as three
-- explicit columns instead, because only those three are ever rewritten and
-- naming them documents the blast radius.
--
-- ⚠️ No FOREIGN KEY to `public.poles` from `pole_plan_backup`: the whole point
-- is to survive the deletion of the rows it describes. `project_id` is likewise
-- unconstrained — a project could in principle be removed while its backup is
-- still wanted for forensics.
--
-- ⚠️ Every object is schema-qualified: an `onemap.poles` table also exists, and
-- search_path being "$user", public is a property of the current role, not a
-- guarantee.

CREATE TABLE IF NOT EXISTS public.pole_plan_import_runs (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         uuid        NOT NULL,
    gpkg_object        text        NOT NULL,
    gpkg_version       text        NOT NULL,
    layer              text        NOT NULL,
    status             text        NOT NULL DEFAULT 'running',
    started_at         timestamptz NOT NULL DEFAULT now(),
    completed_at       timestamptz,
    poles_before       integer,
    poles_after        integer,
    photos_relabelled  integer,
    photos_superseded  integer,
    note               text,
    CONSTRAINT pole_plan_import_runs_status_chk
        CHECK (status IN ('running', 'completed', 'failed', 'rolled_back'))
);

CREATE INDEX IF NOT EXISTS pole_plan_import_runs_project_idx
    ON public.pole_plan_import_runs (project_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.pole_plan_backup (
    run_id   uuid  NOT NULL
             REFERENCES public.pole_plan_import_runs (id) ON DELETE CASCADE,
    pole_id  uuid  NOT NULL,
    row_data jsonb NOT NULL,
    PRIMARY KEY (run_id, pole_id)
);

CREATE TABLE IF NOT EXISTS public.pole_qa_photo_plan_backup (
    run_id     uuid NOT NULL
               REFERENCES public.pole_plan_import_runs (id) ON DELETE CASCADE,
    photo_id   uuid NOT NULL,
    pole_label text,
    zone_no    integer,
    pon_no     integer,
    PRIMARY KEY (run_id, photo_id)
);

COMMENT ON TABLE public.pole_plan_import_runs IS
    'One row per pole-plan (replan) re-import attempt. Written by '
    'scripts/qfield-recon/import_replan_poles.py — see migration 479.';

COMMENT ON TABLE public.pole_plan_backup IS
    'Pre-import snapshot of public.poles rows, as JSONB, keyed by import run. '
    'Restored by import_replan_poles.py --rollback. See migration 479.';

COMMENT ON TABLE public.pole_qa_photo_plan_backup IS
    'Pre-import snapshot of the pole_qa_photos columns a replan rewrites '
    '(pole_label, zone_no, pon_no), keyed by import run. See migration 479.';
