-- Rollback 424: drop the inbound civil-audit status columns.
ALTER TABLE poles DROP COLUMN IF EXISTS field_status_synced_at;
ALTER TABLE poles DROP COLUMN IF EXISTS field_status;
