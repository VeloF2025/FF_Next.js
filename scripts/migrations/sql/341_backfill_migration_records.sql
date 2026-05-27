-- Migration 341: Backfill migrations table + mark 277 as resolved
--
-- Context: migration 277 has been stuck as success=false since ~2026-04-11.
-- Its CHECK constraint failed because production data already contained
-- 'pre_provision', 'serial_mismatch', and 'olt_investigation' values that
-- migration 301 later legalised. The constraint on the DB is already the
-- correct expanded form (301 was applied manually via psql).
--
-- Additionally, migrations 278-340 were applied manually via `psql -f` but
-- never recorded in the migrations table. Because the runner fails at 277
-- and exits, it never had a chance to reach or record them.
--
-- Intentionally absent from the INSERT (already recorded as success before
-- this migration ran): 310, 318, 320, 335 — ON CONFLICT DO NOTHING handles
-- these silently; they are NOT missing from the backfill.
--
-- This migration:
--   1. Upserts 277 as success (UPDATE for the known-failure row; INSERT as
--      fallback in case the row was deleted — both are covered by the single
--      INSERT ... ON CONFLICT below).
--   2. Backfills every manually-applied migration that was never recorded.
--
-- Safe to re-run — wrapped in a transaction; INSERT uses ON CONFLICT DO NOTHING.
-- No schema changes. No data changes.

BEGIN;

INSERT INTO migrations (version, name, success, error_message) VALUES
  -- 277: was recorded as success=false; this row upserts it to success=true.
  --      The UPDATE path is not needed — ON CONFLICT DO UPDATE covers both cases.
  ('277', 'add ticket category and team discipline',    true, NULL),
  ('278', 'expand ticket type for disciplines',         true, NULL),
  ('279', 'shrink ticket type enum',                    true, NULL),
  ('300', 'offline sync automation',                    true, NULL),
  ('301', 'expand ticket category pp olt',              true, NULL),
  ('302', 'backfill pp olt ticket category',            true, NULL),
  ('303', 'qa passfail comment corrections',            true, NULL),
  ('304', 'project team assignments',                   true, NULL),
  ('305', 'action centre phase 1',                      true, NULL),
  ('306', 'action centre rule engine',                  true, NULL),
  ('307', 'attachment ai caption',                      true, NULL),
  ('308', 'verification step ai narrative',             true, NULL),
  ('309', 'expand project team assignment roles',       true, NULL),
  ('311', 'recording bot',                              true, NULL),
  ('312', 'stock serials pp tracking',                  true, NULL),
  ('313', 'wa group types',                             true, NULL),
  ('314', 'rbac billing noninvoiceables',               true, NULL),
  ('315', 'noc taxonomy ingest prep',                   true, NULL),
  ('316', 'backfill verification step attachments',     true, NULL),
  ('317', 'auto promote canonical',                     true, NULL),
  ('319', 'attendance daily summaries',                 true, NULL),
  ('321', 'attendance cartrack verifications',          true, NULL),
  ('322', 'fleet vehicles cartrack id nonblank',        true, NULL),
  ('323', 'attendance verdict device gps off',          true, NULL),
  ('324', 'attendance hourly rate snapshot',            true, NULL),
  ('325', 'attendance rate at clock in',                true, NULL),
  ('326', 'payslips',                                   true, NULL),
  ('327', 'payslips imported by users',                 true, NULL),
  ('328', 'staff receipts',                             true, NULL),
  ('329', 'rewrite legacy vf storage urls',             true, NULL),
  ('330', 'attendance search permission',               true, NULL),
  ('331', 'attendance search presets',                  true, NULL),
  ('332', 'attendance bulk actions',                    true, NULL),
  ('333', 'ai summary unique per ticket',               true, NULL),
  ('334', 'vlm training dataset',                       true, NULL),
  ('336', 'pon manual overrides',                       true, NULL),
  ('337', 'pon change log',                             true, NULL),
  ('339', 'pon change log audit fk fix',                true, NULL),
  ('340', 'pon workspace review fixes',                 true, NULL)
ON CONFLICT (version) DO UPDATE
  SET success       = EXCLUDED.success,
      error_message = EXCLUDED.error_message;

COMMIT;
