-- Rollback for scripts/migrations/sql/373_share_session_actors.sql
-- Drops the actor FK columns then the actors table.
-- WARNING: any actor_id values stamped on steps/attachments will be lost.

-- Partial indexes on the FK columns. Postgres cascades these when the
-- columns drop, but stating them explicitly keeps the rollback symmetric
-- with the forward migration and self-documenting.
DROP INDEX IF EXISTS idx_maintenance_verification_steps_actor;
DROP INDEX IF EXISTS idx_maintenance_attachments_actor;

ALTER TABLE maintenance_verification_steps
  DROP COLUMN IF EXISTS completed_by_actor_id;

ALTER TABLE maintenance_attachments
  DROP COLUMN IF EXISTS uploaded_by_actor_id;

DROP INDEX IF EXISTS idx_share_session_actors_token_fp;
DROP INDEX IF EXISTS idx_share_session_actors_token_hash;

DROP TABLE IF EXISTS share_session_actors;
