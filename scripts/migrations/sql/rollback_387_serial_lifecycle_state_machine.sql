-- Rollback 387: drop new triggers + tables; restore 11-value CHECK; un-rename in_stock.
-- mig 365/366/367 triggers are still installed (Track 2 does not retire them in the
-- same PR as Track 1's foundation), so no re-install needed here.

BEGIN;

DROP TRIGGER IF EXISTS trg_stock_serial_status_validate_t ON stock_serials;
DROP TRIGGER IF EXISTS trg_stock_serial_status_emit_t ON stock_serials;
DROP TRIGGER IF EXISTS trg_stock_serial_holder_validate_t ON stock_serials;
DROP FUNCTION IF EXISTS trg_stock_serial_status_validate();
DROP FUNCTION IF EXISTS trg_stock_serial_status_emit();
DROP FUNCTION IF EXISTS trg_stock_serial_holder_validate();

-- Reverses Track 5 backfill rename (no-op if Track 5 hasn't run yet).
UPDATE stock_serials SET status = 'available' WHERE status = 'in_stock';

ALTER TABLE stock_serials DROP CONSTRAINT IF EXISTS stock_serials_status_check;
ALTER TABLE stock_serials
  ADD CONSTRAINT stock_serials_status_check
  CHECK (status IN (
    'available','reserved','allocated_to_project','in_transit','issued',
    'installed','activated','faulty','in_repair','returned','scrapped'
  ));

DROP TABLE IF EXISTS stock_serial_lifecycle_violations;
DROP TABLE IF EXISTS stock_serial_status_holder_pairs;
DROP TABLE IF EXISTS stock_serial_status_transitions;

DELETE FROM migrations WHERE version = '387';

COMMIT;
