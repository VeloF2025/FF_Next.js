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
-- ── Fan-out: why sow_poles is DISTINCT ON'd ────────────────────────────────
-- `public.poles` carries a unique constraint on (project_id, pole_number) — the
-- GPKG importer relies on it for ON CONFLICT. `sow_poles` carries none: it is a
-- view over sharepoint_hld_pole, a raw external feed. Live data has zero
-- duplicates in either source today (verified 2026-08-01), but nothing enforces
-- that on the sow side.
--
-- A duplicate there is not a cosmetic problem. Two call sites feed this view
-- straight into `INSERT ... SELECT ... LEFT JOIN <view> ... ON CONFLICT
-- (project_id, pole_label) DO UPDATE`. Two candidate rows for one arbiter key
-- makes Postgres abort the whole statement:
--
--   ERROR: ON CONFLICT DO UPDATE command cannot affect row a second time
--
-- Reproduced 2026-08-01 against the live server. That is a 500 on
-- works-qa/sync-historical and on every QField sync, not a bad number. It is
-- also PRE-EXISTING — joining `sow_poles` directly, as this code did before
-- migration 472, produces the identical error, confirmed in the same run. The
-- third site (syncQfieldCore's DO NOTHING upsert) tolerates the fan-out and
-- inserts one row; only DO UPDATE aborts.
--
-- The DISTINCT ON below closes it rather than carrying it forward: the sow side
-- is reduced to one row per (project_id, pole_number) BEFORE the join, so with
-- poles unique-constrained on the same key the FULL JOIN is structurally 1:1 —
-- not merely 1:1 while the feed happens to stay clean. Tie-break prefers a row
-- carrying a zone/PON over one with NULLs, and is fully ordered so the choice is
-- deterministic rather than whatever the scan returns first.
--
-- ⚠️ Label matching is exact. The two feeds are independently populated, so a
-- case/whitespace variant of the same physical pole does NOT merge — it stays as
-- two rows with different pole_number values. Measured on live data
-- 2026-08-01: exactly 1 such pair across all projects. Deliberately NOT
-- normalised (upper/btrim) here: folding case would merge labels this codebase
-- treats as distinct elsewhere, which is a bigger behavioural change than the
-- one row it would fix. Revisit if that count grows.
--
-- ⚠️ The call sites filter on project_id, which lands on COALESCE(...) — a
-- computed column Postgres cannot push through a FULL JOIN. Every read
-- therefore materialises the whole join before filtering. Measured on live data
-- 2026-08-01 for the largest project: two Seq Scans (poles 31,050 rows,
-- sharepoint_hld_pole 13,112), Hash Full Join, 28,829 rows filtered after the
-- join, all shared-buffer hits — 9.5 ms. Acceptable at this size; revisit if
-- either table grows by an order of magnitude.
--
-- ⚠️ Every object is schema-qualified: an `onemap.poles` table also exists, and
-- search_path being "$user", public is a property of the current role, not a
-- guarantee.

CREATE OR REPLACE VIEW public.v_pole_planning AS
WITH sow_dedup AS (
    SELECT DISTINCT ON (project_id, pole_number)
           project_id, pole_number, zone_no, pon_no
      FROM public.sow_poles
     ORDER BY project_id, pole_number, zone_no NULLS LAST, pon_no NULLS LAST
)
SELECT
    COALESCE(sp.project_id,  po.project_id)  AS project_id,
    COALESCE(sp.pole_number, po.pole_number) AS pole_number,
    COALESCE(sp.zone_no,     po.zone_no)     AS zone_no,
    COALESCE(sp.pon_no,      po.pon_no)      AS pon_no
FROM      sow_dedup    sp
FULL JOIN public.poles po
       ON po.project_id  = sp.project_id
      AND po.pole_number = sp.pole_number;

COMMENT ON VIEW public.v_pole_planning IS
    'Planned zone/PON per (project_id, pole_number). Union of sow_poles '
    '(SharePoint HLD feed; Mohadin/Lawley/Mamelodi only) and public.poles '
    '(QField GPKG import; every other project), sow_poles winning per column. '
    'Read by Works QA — see migration 472.';
