-- Rollback for migration 346
--
-- Note: this does NOT revert the one-shot backfill (276 rows whose
-- auto_qa_eligible_at was set to wa_received_at + 30 min on 2026-05-19).
-- Those values remain because they are correct per the column's semantics;
-- the trigger only automates future writes. To also revert the backfill:
--   UPDATE dr_photo_unified_reviews
--   SET auto_qa_eligible_at = NULL
--   WHERE drop_number IN (...);  -- supply the affected drop_numbers

DROP TRIGGER IF EXISTS trg_set_auto_qa_eligible_at ON dr_photo_unified_reviews;
DROP FUNCTION IF EXISTS set_auto_qa_eligible_at();
