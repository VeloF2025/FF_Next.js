-- Rollback for migrations/2026-05-14-share-session-actors.sql
-- Drops the actor FK columns then the actors table.
-- WARNING: any actor_id values stamped on steps/attachments will be lost.

ALTER TABLE maintenance_verification_steps
  DROP COLUMN IF EXISTS completed_by_actor_id;

ALTER TABLE maintenance_attachments
  DROP COLUMN IF EXISTS uploaded_by_actor_id;

DROP INDEX IF EXISTS idx_share_session_actors_token_fp;
DROP INDEX IF EXISTS idx_share_session_actors_token_hash;

DROP TABLE IF EXISTS share_session_actors;
