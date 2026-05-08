-- Migration 340: Review-feedback fixes for the tracker-workspace foundation.
-- Addresses MEDIUM nits raised on PR #1558:
--   1. pct_original / pct_recon had no DB-level [0,1] CHECK constraint —
--      a feed bug writing 1.5 (150%) was silently storable, ≥10.0 would
--      raise a confusing numeric overflow rather than a clear violation.
--   2. pon_manual_overrides had no created_at column; the updated_at
--      trigger doubled as the insert timestamp, conflating semantics.
--
-- Both tables ship in this same PR (335 / 336) and have no rows yet on the
-- shared DB at the time of this migration, so VALIDATEd CHECK / NOT NULL
-- forms are safe.

BEGIN;

-- 1. Percentage clamps. The columns are NUMERIC(5,4) which already caps at
--    9.9999, but a value of 1.5 (mistakenly stored as a percentage rather
--    than a fraction) would slip through. Enforce the documented contract.
ALTER TABLE pon_stage_tracking
  ADD CONSTRAINT pon_stage_tracking_pct_original_bounds
    CHECK (pct_original IS NULL OR (pct_original >= 0 AND pct_original <= 1)),
  ADD CONSTRAINT pon_stage_tracking_pct_recon_bounds
    CHECK (pct_recon IS NULL OR (pct_recon >= 0 AND pct_recon <= 1));

-- 2. pon_manual_overrides should distinguish first-edit timestamp from last
--    edit. created_at defaults to NOW(); existing rows (if any) get backfilled
--    from updated_at so we don't lose ordering.
ALTER TABLE pon_manual_overrides
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE pon_manual_overrides
   SET created_at = COALESCE(updated_at, NOW())
 WHERE created_at IS NOT NULL;
-- (NOT NULL DEFAULT means every existing row already has created_at = NOW();
--  the UPDATE re-anchors them to updated_at when that better reflects truth.)

COMMIT;
