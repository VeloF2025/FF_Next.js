-- Migration 480: mark QA photos a replan supersedes, instead of leaving them silent.
--
-- Additive and idempotent: three nullable columns and one partial index on an existing
-- table. No existing row is written. Safe to re-run.
--
-- NOT wrapped in BEGIN;/COMMIT; on purpose — scripts/run-pending-migrations.sh applies
-- the file inside its own transaction (`psql -1`). Matches 467, 469, 471, 472 and 479.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- A replan re-issues a project under new pole labels. Most QA photos follow their pole
-- (import_replan_poles.py relabels them), and a pole that carries a photo is never
-- deleted — but a photo whose label matches NO pole in either plan has nowhere to go.
--
-- On Thembisa POP 3 that is 34 of 311 photos, and every one is a field data-entry
-- fault rather than a pole the replan retired:
--
--   19  QField auto-ids   (thm-3-poles-thm-3-poles_2026…, no label ever captured)
--    5  typos WITH a real photo key — TEM.J.960 (missing '.P'), TEM.P.M036⁹
--       (superscript), TEM.P.MO84 (letter O for zero), TEM.P.I1884 (extra digit),
--       and one free-text 'New pole'
--   10  labels with no photo key attached
--
-- Those 5 are a crew's actual work. The importer already never deletes them, but until
-- now nothing distinguished them from live QA: they simply sat there with a label
-- pointing at no pole, indistinguishable from a photo whose zone had not synced yet.
-- That ambiguity is the same one migration 479's tool exists to remove.
--
-- ── Marked, not moved ──────────────────────────────────────────────────────
-- Deliberately NOT auto-corrected to the nearest matching label. `TEM.J.960` looks like
-- `TEM.P.J960` and `TEM.P.MO84` looks like `TEM.P.O084`, but a near-miss match is a
-- guess, and a wrong guess files a crew's photo against a different physical pole —
-- worse than leaving it unfiled, and invisible once it happens. The row keeps its
-- original label; a human decides.
--
-- ── Reversible ─────────────────────────────────────────────────────────────
-- superseded_run_id ties each mark to the import that set it, so
-- `import_replan_poles.py --rollback <run_id>` clears exactly the marks that run made
-- and leaves marks from any earlier run alone.
--
-- ⚠️ No FK to pole_plan_import_runs: pruning old run rows must not silently unmark
-- photos, and the mark is meant to outlive its run's bookkeeping.
--
-- ⚠️ Schema-qualified throughout — an `onemap` schema also exists, and search_path
-- being "$user", public is a property of the current role, not a guarantee.

ALTER TABLE public.pole_qa_photos
    ADD COLUMN IF NOT EXISTS superseded_at     timestamptz,
    ADD COLUMN IF NOT EXISTS superseded_run_id uuid,
    ADD COLUMN IF NOT EXISTS superseded_reason text;

-- Partial: the marked rows are a small minority and are always queried as "show me the
-- ones needing attention", never as "is this one row marked".
CREATE INDEX IF NOT EXISTS pole_qa_photos_superseded_idx
    ON public.pole_qa_photos (project_id, superseded_at)
 WHERE superseded_at IS NOT NULL;

COMMENT ON COLUMN public.pole_qa_photos.superseded_at IS
    'When a pole-plan replan left this photo with no matching pole. The row is kept '
    'and its label untouched — see migration 480.';
COMMENT ON COLUMN public.pole_qa_photos.superseded_run_id IS
    'The pole_plan_import_runs row that set this mark; --rollback clears only its own.';
COMMENT ON COLUMN public.pole_qa_photos.superseded_reason IS
    'Why the photo could not be placed, for the human who triages it.';
