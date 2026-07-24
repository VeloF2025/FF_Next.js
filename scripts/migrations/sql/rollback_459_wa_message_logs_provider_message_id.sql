-- Rollback 459: drop the wamid idempotency column + its partial unique index.
BEGIN;
DROP INDEX IF EXISTS idx_wa_logs_provider_message_id;
ALTER TABLE wa_message_logs DROP COLUMN IF EXISTS provider_message_id;
COMMIT;
