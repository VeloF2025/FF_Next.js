-- Rollback 517_eod_sheet_content_hash.sql
-- Re-opens duplicate recording on the scanned path. Sheets are NOT deleted.
DROP INDEX IF EXISTS uq_eod_sheets_content_hash;
ALTER TABLE eod_install_sheets DROP COLUMN IF EXISTS content_hash;
