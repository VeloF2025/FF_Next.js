-- Rollback for migration 346

DROP TRIGGER IF EXISTS trg_set_auto_qa_eligible_at ON dr_photo_unified_reviews;
DROP FUNCTION IF EXISTS set_auto_qa_eligible_at();
