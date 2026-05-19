-- Migration 346: Auto-set auto_qa_eligible_at when wa_received_at is populated
--
-- Problem: dr_photo_unified_reviews has 7+ insert/update paths
-- (drRecordInserts, dropSyncService, oesUnifiedRecordsService, unifiedDbService,
-- drStatusService, ensure-data, sync-dr-photo-categorization). Only drRecordInserts
-- sets auto_qa_eligible_at, so DRs whose wa_received_at is populated by any other
-- path stay invisible to the auto-QA cron (filter: auto_qa_eligible_at <= NOW()).
--
-- Found 2026-05-19: 276 WA-originated DRs stuck with auto_qa_eligible_at IS NULL
-- despite wa_received_at being set. Backfilled separately; this trigger prevents
-- recurrence regardless of which code path writes the row.

CREATE OR REPLACE FUNCTION set_auto_qa_eligible_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.wa_received_at IS NOT NULL
     AND NEW.auto_qa_eligible_at IS NULL THEN
    NEW.auto_qa_eligible_at := NEW.wa_received_at + INTERVAL '30 minutes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_auto_qa_eligible_at ON dr_photo_unified_reviews;

-- No column list on UPDATE: any update to a broken row (NULL auto_qa_eligible_at
-- with non-NULL wa_received_at) is self-healing. The IS NULL guard inside the
-- function keeps the body a no-op for the common case where the column is
-- already set, so the overhead is one row-level NULL check per update.
CREATE TRIGGER trg_set_auto_qa_eligible_at
BEFORE INSERT OR UPDATE ON dr_photo_unified_reviews
FOR EACH ROW
EXECUTE FUNCTION set_auto_qa_eligible_at();

COMMENT ON FUNCTION set_auto_qa_eligible_at IS
  'Ensures auto_qa_eligible_at = wa_received_at + 30 min for any WA-originated DR, regardless of which insert/update code path created it.';
