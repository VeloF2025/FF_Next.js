-- 384_pure_custody_model.sql
-- Sprint D: pure custody model. Holder-keyed balance + ledger holder endpoints +
-- live accountability views + obsolete-trigger cleanup.
-- See docs/superpowers/specs/2026-05-26-pure-custody-model-sprintD-design.md
BEGIN;

-- 1. Holder-keyed custody balance (mirrors stock_quants shape + ON CONFLICT key)
CREATE TABLE IF NOT EXISTS stock_custody (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_id          uuid NOT NULL REFERENCES stock_holders(id),
  stock_item_id      uuid NOT NULL REFERENCES stock_items(id),
  lot_number         varchar(100),
  quantity           numeric(12,3) NOT NULL DEFAULT 0,
  reserved_quantity  numeric(12,3) DEFAULT 0,
  unit_cost          numeric(12,2),
  total_value        numeric(14,2),
  last_movement_date timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_custody_unique
  ON stock_custody (holder_id, stock_item_id, COALESCE(lot_number, ''));
CREATE INDEX IF NOT EXISTS idx_stock_custody_holder ON stock_custody (holder_id);
CREATE INDEX IF NOT EXISTS idx_stock_custody_item   ON stock_custody (stock_item_id);

-- 2. Persistent accountability decisions only (numbers come from the view)
CREATE TABLE IF NOT EXISTS stock_accountability (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_id                uuid NOT NULL UNIQUE REFERENCES stock_holders(id),
  is_blocked               boolean NOT NULL DEFAULT false,
  blocked_reason           text,
  blocked_at               timestamptz,
  blocked_by               varchar(255),
  pending_recovery_amount  numeric(14,2) DEFAULT 0,
  recovered_amount         numeric(14,2) DEFAULT 0,
  last_reconciliation_date timestamptz,
  last_reconciliation_by   varchar(255),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_accountability_blocked ON stock_accountability (is_blocked);

-- 3. Holder endpoints on the single ledger (back-compatible: existing 496 rows have holder cols NULL)
ALTER TABLE field_stock_movements
  ADD COLUMN IF NOT EXISTS from_holder_id uuid REFERENCES stock_holders(id),
  ADD COLUMN IF NOT EXISTS to_holder_id   uuid REFERENCES stock_holders(id);
ALTER TABLE field_stock_movements
  ADD CONSTRAINT field_stock_movements_from_endpoint_chk
    CHECK (from_location_id IS NULL OR from_holder_id IS NULL),
  ADD CONSTRAINT field_stock_movements_to_endpoint_chk
    CHECK (to_location_id IS NULL OR to_holder_id IS NULL);
CREATE INDEX IF NOT EXISTS idx_fsm_from_holder ON field_stock_movements (from_holder_id) WHERE from_holder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fsm_to_holder   ON field_stock_movements (to_holder_id)   WHERE to_holder_id   IS NOT NULL;

-- 4. Holder on serials + the issue/consume documents
ALTER TABLE stock_serials      ADD COLUMN IF NOT EXISTS holder_id uuid REFERENCES stock_holders(id);
ALTER TABLE stock_pickings     ADD COLUMN IF NOT EXISTS holder_id uuid REFERENCES stock_holders(id);
ALTER TABLE stock_consumptions ADD COLUMN IF NOT EXISTS holder_id uuid REFERENCES stock_holders(id);
CREATE INDEX IF NOT EXISTS idx_stock_serials_holder ON stock_serials (holder_id) WHERE holder_id IS NOT NULL;

-- 5. Live holder accountability view
CREATE OR REPLACE VIEW v_holder_accountability AS
SELECT
  h.id AS holder_id, h.holder_type, h.staff_id, h.contractor_id, h.name, h.is_active,
  COALESCE(iss.cnt, 0)  AS issued_count,    COALESCE(iss.val, 0)  AS issued_value,
  COALESCE(con.cnt, 0)  AS consumed_count,  COALESCE(con.val, 0)  AS consumed_value,
  COALESCE(ret.cnt, 0)  AS returned_count,  COALESCE(ret.val, 0)  AS returned_value,
  COALESCE(held.qty, 0) AS held_count,      COALESCE(held.val, 0) AS held_value,
  COALESCE(iss.cnt,0) - COALESCE(con.cnt,0) - COALESCE(ret.cnt,0) - COALESCE(held.qty,0) AS unaccounted_count,
  COALESCE(sa.is_blocked, false) AS is_blocked,
  sa.blocked_reason, sa.blocked_at, sa.blocked_by,
  COALESCE(sa.pending_recovery_amount, 0) AS pending_recovery_amount,
  COALESCE(sa.recovered_amount, 0)        AS recovered_amount,
  sa.last_reconciliation_date, sa.last_reconciliation_by
FROM stock_holders h
LEFT JOIN stock_accountability sa ON sa.holder_id = h.id
LEFT JOIN LATERAL (SELECT SUM(quantity) cnt, SUM(total_cost) val FROM field_stock_movements
                   WHERE to_holder_id   = h.id AND movement_type='issue')       iss ON true
LEFT JOIN LATERAL (SELECT SUM(quantity) cnt, SUM(total_cost) val FROM field_stock_movements
                   WHERE from_holder_id = h.id AND movement_type='consumption') con ON true
LEFT JOIN LATERAL (SELECT SUM(quantity) cnt, SUM(total_cost) val FROM field_stock_movements
                   WHERE from_holder_id = h.id AND movement_type='return')      ret ON true
LEFT JOIN LATERAL (SELECT SUM(quantity) qty, SUM(total_value) val FROM stock_custody
                   WHERE holder_id = h.id)                                      held ON true;

-- 6. Contractor rollup shim (keeps legacy contractor-grain consumers alive)
CREATE OR REPLACE VIEW v_contractor_accountability AS
SELECT
  h.contractor_id,
  SUM(va.issued_count)            AS total_issued_count,
  SUM(va.consumed_count)          AS total_consumed_count,
  SUM(va.returned_count)          AS total_returned_count,
  SUM(va.held_count)              AS current_held_count,
  SUM(va.held_value)              AS current_held_value,
  SUM(va.unaccounted_count)       AS unaccounted_count,
  bool_or(va.is_blocked)          AS is_blocked,
  SUM(va.pending_recovery_amount) AS pending_recovery_amount
FROM v_holder_accountability va
JOIN stock_holders h ON h.id = va.holder_id
WHERE h.contractor_id IS NOT NULL
GROUP BY h.contractor_id;

-- 7. Trigger cleanup (verified safe — R3 in the spec)
--   (a) drop the fully-obsolete mig-029 accountability trigger + function
DROP TRIGGER IF EXISTS trg_update_accountability_on_issue ON stock_pickings;
DROP FUNCTION IF EXISTS update_accountability_on_issue();
--   (b) re-create the mig-366 picking-done trigger fn WITHOUT the contractor_stock_accountability
--       counter block; keep serial-event emission + serial status update verbatim.
CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_picking_done()
RETURNS TRIGGER AS $$
DECLARE
  v_serial_id  UUID;
  v_event_type VARCHAR(50);
  v_to_state   VARCHAR(50);
BEGIN
  BEGIN
    IF NEW.picking_type = 'transfer' THEN
      v_event_type := 'transferred'; v_to_state := 'in_transit';
    ELSE
      v_event_type := 'issued';      v_to_state := 'issued';
    END IF;

    FOR v_serial_id IN
      SELECT unnest(spl.serial_ids) FROM stock_picking_lines spl
      WHERE spl.picking_id = NEW.id AND spl.serial_ids IS NOT NULL
        AND array_length(spl.serial_ids, 1) > 0
    LOOP
      INSERT INTO stock_serial_events
        (serial_id, event_type, from_state, to_state, source_table, source_id, actor_staff_id, payload, occurred_at)
      SELECT v_serial_id, v_event_type, ss.status, v_to_state, 'stock_pickings', NEW.id, NEW.technician_id,
             jsonb_build_object('picking_type', NEW.picking_type),
             COALESCE(NEW.signed_at, NEW.effective_date, NEW.approved_at, NOW())
      FROM stock_serials ss WHERE ss.id = v_serial_id
      ON CONFLICT (serial_id, source_table, source_id, event_type) WHERE source_id IS NOT NULL DO NOTHING;

      UPDATE stock_serials SET status = v_to_state, updated_at = NOW()
      WHERE id = v_serial_id AND status NOT IN ('faulty','scrapped','in_repair','returned');
    END LOOP;
    -- NOTE: contractor_stock_accountability counter block REMOVED (Sprint D — live view supersedes it).
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trg_emit_serial_event_on_picking_done: % — %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

INSERT INTO migrations (version, name, executed_at)
VALUES ('384', 'pure_custody_model', NOW());

COMMIT;
