-- Migration 472: v_pole_planning — single planned-zone/PON source for Works QA.
--
-- Additive and idempotent: creates one read-only view, touches no data and no
-- existing object. Safe to re-run.
--
-- NOT wrapped in BEGIN;/COMMIT; on purpose. scripts/run-pending-migrations.sh
-- applies this file as `psql -1 -c "\i <file>" -c "INSERT INTO
-- schema_migrations ..."`. Postgres does not nest transactions, so a COMMIT
-- inside the file ends psql's transaction early and lets the DDL commit while
-- its tracker row fails independently. Matches 467, 469 and 471.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- Works QA resolves a pole's planned zone/PON from `sow_poles` in four places
-- (works-qa/zones.ts, works-qa/sync-historical.ts, and twice in
-- syncQfieldCore.ts). `sow_poles` is NOT a table: it is a view over
-- `sharepoint_hld_pole`, the SharePoint HLD feed, which was loaded once on
-- 2026-01-09 and covers only Mohadin, Lawley and Mamelodi.
--
-- Every other project's planning lives in `public.poles` (zone_no, pon_no,
-- source='qfield'), written by the QField GPKG import. For those projects the
-- sow_poles join returns NULL, so each synced pole lands with zone_no = NULL
-- and pon_no = NULL. WorksQAFiltersBar then drops null zones from the dropdown,
-- leaving the poles reachable only via "All Zones", and the "planned" counter
-- degenerates into counting the photographed poles themselves.
--
-- Observed on Thembisa POP 3 (2026-08-01): 43 of 244 QA poles unzoned, the zone
-- dropdown offering 7 photo-derived zones instead of the 27 planned ones, and a
-- funnel reading "211 planned → 244 planted".
--
-- ── Precedence ─────────────────────────────────────────────────────────────
-- sow_poles wins per column, poles fills the gaps. That keeps the three
-- SharePoint projects on exactly the values they resolve to today and only adds
-- poles that sow_poles does not carry at all. Measured against the live shared
-- database on 2026-08-01:
--
--   project          sow_poles   public.poles   this view
--   Mohadin               5312           5400        5401   (+89)
--   Lawley                4471           4937        4937   (+466)
--   Mamelodi              3329           1963        3334   (+5)
--   Etwatwa                  0           4538        4538   (unlocked)
--   Grabouw                  0           3793        3793   (unlocked)
--   Thembisa POP 3           0           3594        3594   (unlocked)
--   Thembisa POP 1           0           2817        2817   (unlocked)
--   Tonga                    0           2200        2200   (unlocked)
--   Themb'elihle             0           1808        1808   (unlocked)
--
-- The three SharePoint projects therefore see a small increase in "planned";
-- the other six go from "no planning at all" to their real zone/PON.
--
-- ── Fan-out ────────────────────────────────────────────────────────────────
-- Verified 2026-08-01 on the live database: zero duplicate
-- (project_id, pole_number) groups in either sow_poles or public.poles, so the
-- FULL OUTER JOIN is 1:1 and cannot multiply rows. `public.poles` already
-- carries a unique constraint on (project_id, pole_number) — the GPKG importer
-- relies on it for ON CONFLICT. sow_poles has no such constraint (it is a
-- view), so a future duplicate in sharepoint_hld_pole WOULD fan out here.
--
-- ⚠️ `poles` is schema-qualified as public.poles throughout: an `onemap.poles`
-- table also exists. search_path is "$user", public today, so an unqualified
-- reference resolves correctly — but only by accident of search_path.

CREATE OR REPLACE VIEW v_pole_planning AS
SELECT
    COALESCE(sp.project_id,  po.project_id)  AS project_id,
    COALESCE(sp.pole_number, po.pole_number) AS pole_number,
    COALESCE(sp.zone_no,     po.zone_no)     AS zone_no,
    COALESCE(sp.pon_no,      po.pon_no)      AS pon_no
FROM      public.sow_poles sp
FULL JOIN public.poles     po
       ON po.project_id  = sp.project_id
      AND po.pole_number = sp.pole_number;

COMMENT ON VIEW v_pole_planning IS
    'Planned zone/PON per (project_id, pole_number). Union of sow_poles '
    '(SharePoint HLD feed; Mohadin/Lawley/Mamelodi only) and public.poles '
    '(QField GPKG import; every other project), sow_poles winning per column. '
    'Read by Works QA — see migration 472.';
