-- Rollback: 469_wa_subscriber_consent.sql
--
-- ⚠️ THIS DESTROYS CONSENT AND WITHDRAWAL RECORDS, WHICH ARE NOT RECOVERABLE FROM
-- ANYWHERE ELSE. A withdrawn row is the only evidence that a subscriber asked not to be
-- contacted; dropping the table does not merely lose an audit trail, it removes the
-- record that would stop the next send. Whoever runs this must accept that every
-- subscriber reverts to "no record", which the guard reads as "no consent" — so the
-- fail-closed behaviour survives, but a previously-honoured withdrawal can be re-granted
-- by the next FNO payload as though it never happened.
--
-- Export before running if there is any chance the data matters:
--   \copy (SELECT * FROM wa_subscriber_consent) TO 'consent-backup.csv' CSV HEADER
--
-- CALLER DEPENDENCY: the outbound precondition guard SELECTs this table on every
-- business-initiated send. Dev and production share one database, so running this while
-- that code is deployed makes the guard's query fail. The guard is written to treat its
-- own failure as "no consent" and refuse the send, so the outcome is refused messages
-- rather than unlawful ones — but it is still a broken send path. Revert the application
-- code first, or do both together.
BEGIN;

DROP INDEX IF EXISTS idx_wa_subscriber_consent_drop;
DROP INDEX IF EXISTS ux_wa_subscriber_consent_msisdn;

-- Constraints go with the table, but drop them explicitly so a partially-applied
-- forward run (table created, constraints added, later statement failed) still rolls
-- back cleanly on re-run.
ALTER TABLE IF EXISTS wa_subscriber_consent DROP CONSTRAINT IF EXISTS wa_subscriber_consent_source_chk;
ALTER TABLE IF EXISTS wa_subscriber_consent DROP CONSTRAINT IF EXISTS wa_subscriber_consent_status_chk;

DROP TABLE IF EXISTS wa_subscriber_consent;

-- Clear the tracker so the forward migration is re-applied on the next deploy. The
-- rollback CLI (scripts/migrations/run.ts) also does this, but a rollback run by hand
-- with `psql -f` would otherwise leave 469 recorded as applied and the table gone — a
-- state the forward runner will never repair on its own. Matches rollback_451..457,
-- 461..464 and 467.
DELETE FROM schema_migrations WHERE filename = '469_wa_subscriber_consent.sql';

COMMIT;
