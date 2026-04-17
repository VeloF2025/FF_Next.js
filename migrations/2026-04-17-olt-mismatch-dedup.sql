-- migrations/2026-04-17-olt-mismatch-dedup.sql
-- Deduplicate olt_mismatch_records and prevent future duplicates.
--
-- Context: The OLT queue processor had a concurrency race (unlocked SELECT +
-- read-then-insert in insertMismatchIfNew) that created duplicate rows for the
-- same drop when two workers processed a queue item simultaneously. Six DRs
-- are currently affected; 4 of those also spawned duplicate NOC tickets.
--
-- This migration:
--   1. Deletes the later row of each duplicate pair (keeps earliest per DR).
--   2. Adds a partial unique index on drop_number for active fix_statuses so
--      the database rejects any future race that the app-layer fix misses.
--
-- NOTE: The 4 duplicate maintenance_tickets (VF-20260313-077, -083, -093, -095)
-- are NOT touched here — they're orphaned from any mismatch row but still
-- visible to NOC. Handle them via the NOC workflow after review.

BEGIN;

-- 1. Delete later duplicates (keep earliest by created_at per drop_number)
WITH ranked AS (
  SELECT id,
         drop_number,
         ROW_NUMBER() OVER (PARTITION BY drop_number ORDER BY created_at ASC, id ASC) AS rn
  FROM olt_mismatch_records
  WHERE fix_status IN ('pending','needs_investigation','not_found','empty_serial','needs_reinvestigation')
)
DELETE FROM olt_mismatch_records
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Enforce uniqueness going forward for active (unresolved) rows only.
--    Resolved/fixed/escalated rows are history and may legitimately recur.
CREATE UNIQUE INDEX IF NOT EXISTS idx_olt_mismatch_drop_active_uniq
  ON olt_mismatch_records (drop_number)
  WHERE fix_status IN ('pending','needs_investigation','not_found','empty_serial','needs_reinvestigation');

COMMENT ON INDEX idx_olt_mismatch_drop_active_uniq IS
  'Prevents duplicate active mismatch rows for the same DR. Backstops the app-layer upsert in oltQueueProcessorService and oltAutoDetectService.';

COMMIT;
