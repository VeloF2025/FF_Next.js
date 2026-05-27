-- Rollback for Migration 337
-- WARNING: Drops the audit log permanently. Any change history for tracker-workspace
-- edits and feed-sourced updates will be lost. Only run on a test/empty DB or
-- before any real audit data has accumulated.

BEGIN;
DROP TABLE IF EXISTS pon_change_log;
COMMIT;
