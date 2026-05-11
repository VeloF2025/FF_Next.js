-- Migration 341: Backfill migrations table + mark 277 as resolved
--
-- Context: migration 277 has been stuck as success=false since ~2026-04-11.
-- Its CHECK constraint failed because production data already contained
-- 'pre_provision', 'serial_mismatch', and 'olt_investigation' values that
-- migration 301 later legalised. The constraint on the DB is already the
-- correct expanded form (301 was applied manually via psql).
--
-- Additionally, migrations 278-309, 311-317, 319, 321-334, 336, 337, 339,
-- and 340 were all applied manually via `psql -f` but never recorded in the
-- migrations table. Because the runner fails at 277 and exits, it never had
-- a chance to reach or record them.
--
-- This migration:
--   1. Marks 277 as success (DB constraint is already correct).
--   2. Backfills the missing rows for every manually-applied migration.
--
-- Safe to re-run — all statements use ON CONFLICT DO NOTHING.
-- No schema changes. No data changes.

-- Step 1: resolve migration 277
UPDATE migrations
SET    success       = true,
       error_message = NULL
WHERE  version = '277';

-- Step 2: backfill manually-applied migrations that were never recorded
INSERT INTO migrations (version, name, success) VALUES
  ('278', 'expand ticket type for disciplines',       true),
  ('279', 'shrink ticket type enum',                  true),
  ('300', 'offline sync automation',                  true),
  ('301', 'expand ticket category pp olt',            true),
  ('302', 'backfill pp olt ticket category',          true),
  ('303', 'qa passfail comment corrections',          true),
  ('304', 'project team assignments',                 true),
  ('305', 'action centre phase 1',                    true),
  ('306', 'action centre rule engine',                true),
  ('307', 'attachment ai caption',                    true),
  ('308', 'verification step ai narrative',           true),
  ('309', 'expand project team assignment roles',     true),
  ('311', 'recording bot',                            true),
  ('312', 'stock serials pp tracking',                true),
  ('313', 'wa group types',                           true),
  ('314', 'rbac billing noninvoiceables',             true),
  ('315', 'noc taxonomy ingest prep',                 true),
  ('316', 'backfill verification step attachments',   true),
  ('317', 'auto promote canonical',                   true),
  ('319', 'attendance daily summaries',               true),
  ('321', 'attendance cartrack verifications',        true),
  ('322', 'fleet vehicles cartrack id nonblank',      true),
  ('323', 'attendance verdict device gps off',        true),
  ('324', 'attendance hourly rate snapshot',          true),
  ('325', 'attendance rate at clock in',              true),
  ('326', 'payslips',                                 true),
  ('327', 'payslips imported by users',               true),
  ('328', 'staff receipts',                           true),
  ('329', 'rewrite legacy vf storage urls',           true),
  ('330', 'attendance search permission',             true),
  ('331', 'attendance search presets',                true),
  ('332', 'attendance bulk actions',                  true),
  ('333', 'ai summary unique per ticket',             true),
  ('334', 'vlm training dataset',                     true),
  ('336', 'pon manual overrides',                     true),
  ('337', 'pon change log',                           true),
  ('339', 'pon change log audit fk fix',              true),
  ('340', 'pon workspace review fixes',               true)
ON CONFLICT (version) DO NOTHING;
