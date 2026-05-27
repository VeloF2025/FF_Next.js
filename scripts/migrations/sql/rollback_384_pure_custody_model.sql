-- rollback_384_pure_custody_model.sql
-- Reverses 384: drops the custody/accountability schema and restores the mig-366
-- picking-done trigger body (with its contractor_stock_accountability counter block).
-- (mig-029 trg_update_accountability_on_issue is intentionally NOT restored — superseded.)
BEGIN;

DROP VIEW IF EXISTS v_contractor_accountability;
DROP VIEW IF EXISTS v_holder_accountability;

ALTER TABLE field_stock_movements
  DROP CONSTRAINT IF EXISTS field_stock_movements_from_endpoint_chk,
  DROP CONSTRAINT IF EXISTS field_stock_movements_to_endpoint_chk;
ALTER TABLE field_stock_movements DROP COLUMN IF EXISTS from_holder_id, DROP COLUMN IF EXISTS to_holder_id;

ALTER TABLE stock_serials      DROP COLUMN IF EXISTS holder_id;
ALTER TABLE stock_pickings     DROP COLUMN IF EXISTS holder_id;
ALTER TABLE stock_consumptions DROP COLUMN IF EXISTS holder_id;

DROP TABLE IF EXISTS stock_accountability;
DROP TABLE IF EXISTS stock_custody;

-- Restore the mig-366 trigger body verbatim (re-adds the contractor counter block).
CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_picking_done()
RETURNS TRIGGER AS $$
DECLARE
  v_serial_id  UUID;
  v_event_type VARCHAR(50);
  v_to_state   VARCHAR(50);
  v_count      INTEGER := 0;
BEGIN
  BEGIN
    IF NEW.picking_type = 'transfer' THEN
      v_event_type := 'transferred';
      v_to_state   := 'in_transit';
    ELSE
      v_event_type := 'issued';
      v_to_state   := 'issued';
    END IF;

    FOR v_serial_id IN
      SELECT unnest(spl.serial_ids)
      FROM   stock_picking_lines spl
      WHERE  spl.picking_id      = NEW.id
        AND  spl.serial_ids     IS NOT NULL
        AND  array_length(spl.serial_ids, 1) > 0
    LOOP
      INSERT INTO stock_serial_events (
        serial_id, event_type, from_state, to_state,
        source_table, source_id, actor_staff_id, payload, occurred_at)
      SELECT
        v_serial_id,
        v_event_type,
        ss.status,
        v_to_state,
        'stock_pickings',
        NEW.id,
        NEW.technician_id,
        jsonb_build_object('picking_type', NEW.picking_type),
        COALESCE(NEW.signed_at, NEW.effective_date, NEW.approved_at, NOW())
      FROM stock_serials ss
      WHERE ss.id = v_serial_id
      ON CONFLICT (serial_id, source_table, source_id, event_type)
        WHERE source_id IS NOT NULL
        DO NOTHING;

      UPDATE stock_serials
      SET    status     = v_to_state,
             updated_at = NOW()
      WHERE  id     = v_serial_id
        AND  status NOT IN ('faulty', 'scrapped', 'in_repair', 'returned');

      v_count := v_count + 1;
    END LOOP;

    IF NEW.contractor_id IS NOT NULL AND v_count > 0 THEN
      INSERT INTO contractor_stock_accountability
        (contractor_id, contractor_name, total_issued_count, total_returned_count)
      VALUES (
        NEW.contractor_id,
        COALESCE(NEW.contractor_name, 'unknown'),
        v_count,
        0)
      ON CONFLICT (contractor_id) DO UPDATE
        SET total_issued_count =
              contractor_stock_accountability.total_issued_count + v_count;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trg_emit_serial_event_on_picking_done: % — %', SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DELETE FROM migrations WHERE version = '384';
COMMIT;
