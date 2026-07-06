-- scripts/migrations/sql/438_maintenance_attachments_client_upload_id.sql
-- Idempotency key for maintenance_attachments so an at-least-once offline-queue
-- retry (the Snags offline-photo PWA feature, Phase 1) that re-POSTs a photo
-- after a lost 2xx does NOT create a duplicate attachment row.
--
-- Context (verified against the live schema before writing this):
--   * The slot upsert (maintenance_step_photos) is already idempotent via
--     ON CONFLICT (step_id, slot_key), so it needs no change.
--   * attachments_count on maintenance_tickets is maintained by the AFTER
--     INSERT/DELETE trigger `trigger_increment_attachments_count`. Because the
--     handler's INSERT will use ON CONFLICT (client_upload_id) DO NOTHING, a
--     deduped retry inserts no row, the trigger does not fire, and the counter
--     is therefore idempotent for free. (The handler's now-removed explicit
--     `attachments_count + 1` was a latent double-count on top of that trigger.)
--
-- Additive + nullable so existing rows and legacy/online uploads (which send no
-- clientUploadId) keep working unchanged. The unique index is PARTIAL
-- (WHERE client_upload_id IS NOT NULL) so the many NULL rows never collide —
-- ON CONFLICT (client_upload_id) WHERE client_upload_id IS NOT NULL infers it.
-- Runner-tracked numbered path only (schema_migrations by filename); no
-- INSERT INTO migrations — see [[feedback_dual_migration_trackers_drift]].

ALTER TABLE maintenance_attachments
  ADD COLUMN IF NOT EXISTS client_upload_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_attachments_client_upload_id
  ON maintenance_attachments (client_upload_id)
  WHERE client_upload_id IS NOT NULL;
