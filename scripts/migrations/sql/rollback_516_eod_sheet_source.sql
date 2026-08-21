-- Rollback 516_eod_sheet_source.sql
-- Loses the distinction between scanned and VLM-extracted sheets. The sheets
-- and their entries are NOT deleted — they are records of real paper.
DROP INDEX IF EXISTS idx_eod_sheets_source;
ALTER TABLE eod_install_sheets DROP CONSTRAINT IF EXISTS eod_install_sheets_source_check;
ALTER TABLE eod_install_sheets DROP COLUMN IF EXISTS source;
