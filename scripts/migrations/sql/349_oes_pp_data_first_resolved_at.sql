-- 349: Add immutable first_resolved_at to oes_pp_data.
--
-- resolved_at gets overwritten on every re-resolve (e.g. if the resolve
-- pipeline re-runs against a serial after a higher-priority source becomes
-- available). For the "Located" column on the PP data dashboard we want the
-- ORIGINAL date we first matched the serial to a DR — that anchors the row
-- on the timeline and never changes.
--
-- Idempotent.

ALTER TABLE oes_pp_data
  ADD COLUMN IF NOT EXISTS first_resolved_at TIMESTAMPTZ;

-- Backfill: any row already resolved gets first_resolved_at = resolved_at.
-- Plays safe — only writes where target is NULL and source is set.
UPDATE oes_pp_data
SET first_resolved_at = resolved_at
WHERE first_resolved_at IS NULL
  AND resolved_at IS NOT NULL;

-- Helpful index for sorting the dashboard by first-located date.
CREATE INDEX IF NOT EXISTS idx_oes_pp_data_first_resolved_at
  ON oes_pp_data (first_resolved_at DESC NULLS LAST)
  WHERE first_resolved_at IS NOT NULL;

COMMENT ON COLUMN oes_pp_data.first_resolved_at IS
  'Immutable: timestamp of the FIRST successful resolution of this serial to a DR. Set once on first transition out of not_found; never overwritten on subsequent re-resolves. resolved_at, by contrast, reflects the most recent resolution.';
