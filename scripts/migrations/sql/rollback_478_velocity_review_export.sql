-- Rollback migration 478 while preserving consent status and audit timestamps.
-- scripts/migrations/run.ts owns the surrounding transaction.

UPDATE wa_subscriber_consent
SET source = 'import'
WHERE source IN ('onemap_home_signup', 'onemap_install_signature');

ALTER TABLE wa_subscriber_consent
  DROP CONSTRAINT IF EXISTS wa_subscriber_consent_source_chk;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wa_subscriber_consent_source_chk'
      AND conrelid = 'wa_subscriber_consent'::regclass
  ) THEN
    ALTER TABLE wa_subscriber_consent
      ADD CONSTRAINT wa_subscriber_consent_source_chk CHECK (source IN (
        'fno_payload', 'ops_manual', 'subscriber_block', 'inbound_stop', 'import'
      ));
  END IF;
END $$;

ALTER TABLE IF EXISTS velocity_review_candidates
  DROP CONSTRAINT IF EXISTS velocity_review_candidates_export_fk;

DROP INDEX IF EXISTS ux_velocity_review_one_phone_inflight;

DROP TABLE IF EXISTS velocity_review_candidates;
DROP TABLE IF EXISTS velocity_review_exports;
DROP TABLE IF EXISTS velocity_review_runs;
DROP TABLE IF EXISTS velocity_review_control;

DELETE FROM schema_migrations
WHERE filename = '478_velocity_review_export.sql';
