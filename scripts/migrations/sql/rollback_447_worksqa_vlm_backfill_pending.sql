-- Rollback for 447_worksqa_vlm_backfill_pending.sql
--
-- Intentionally a NO-OP. The forward migration normalises never-scored
-- placeholder markers to the canonical pending marker {scored:false}, which is
-- the CORRECT state (the photos were never VLM-scored). Reverting would:
--   1. re-introduce the false-negative "VLM fail" rendering the migration fixed,
--      and
--   2. be ambiguous -- a {scored:false} entry produced by this backfill is
--      indistinguishable from one written by the (now-fixed) QField sync for a
--      genuinely new unscored photo, so a blanket revert would corrupt
--      legitimately-pending new markers.
-- If a revert is ever truly required, restore pole_qa_photos.vlm_results from a
-- backup taken before the migration ran. No automatic downgrade is provided.

SELECT 1;  -- no-op
