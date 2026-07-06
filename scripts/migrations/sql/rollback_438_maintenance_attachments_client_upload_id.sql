-- Rollback for 438_maintenance_attachments_client_upload_id.sql
-- Additive column + partial unique index; dropping both is safe (any
-- idempotency keys recorded so far are only useful for in-flight retries).

DROP INDEX IF EXISTS uq_maintenance_attachments_client_upload_id;

ALTER TABLE maintenance_attachments
  DROP COLUMN IF EXISTS client_upload_id;
