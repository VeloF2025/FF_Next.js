-- Migration 281: EOD install sheets — capture the Gizzu DR column.
-- The Velocity install form has TWO handwritten DR columns per row: column 2
-- records where the ONT was installed, column 4 records where the Gizzu was
-- installed. Across 10 rows the same 10 DRs appear in both columns but in
-- different order — technicians record ONT installs and Gizzu installs as
-- they happen, not by drop.
--
-- The existing `dr_number` is the ONT-DR (column 2) and remains the primary
-- match key for `writeBackDrSerials` and `eodReconciliationService`. This
-- migration adds `gizzu_dr_number` (column 4) as a NULLABLE find-it-later
-- field; no consumer reads it today. Historical sheets stay NULL.

BEGIN;

ALTER TABLE eod_install_sheet_entries
  ADD COLUMN IF NOT EXISTS gizzu_dr_number TEXT;

COMMENT ON COLUMN eod_install_sheet_entries.gizzu_dr_number IS
  'DR where the Gizzu in this row was installed (form column 4). May differ from dr_number — technicians do not pair ONT and Gizzu installs by drop.';

COMMIT;
