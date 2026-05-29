-- Rollback for Migration 392: restore contractor_stock_accountability (Sprint E — Track 4.5)
--
-- Run MANUALLY during an incident (ungated, like rollback_387). If rolling back the
-- whole Sprint E cutover, run rollbacks in REVERSE numeric order: rollback_392 FIRST,
-- then rollback_387 — see docs/runbooks/sprint-e-rollback.md.
--
-- Restores:
--   1. The contractor_stock_accountability table + indexes + comments (from mig 029).
--      Recreated EMPTY — it held 0 rows at drop time, so this matches the pre-392 state.
--   2. trg_emit_serial_event_on_return_disposition WITH the restock-accountability
--      block re-added (the exact pre-392 / mig 364 prod body).
--   3. Removes the version-392 marker row so the runner re-applies 392 if re-deployed.
--
-- NOTE: reconcile-queries.sql' accountability_*_counter_drift checks were removed in
-- the 392 PR; if a full Sprint E rollback is performed, restore them from git
-- (origin/master before the Track 4.5 PR) alongside this script if those checks are
-- still wanted.

BEGIN;

-- 1. Recreate the counter table (verbatim from mig 029).
CREATE TABLE IF NOT EXISTS contractor_stock_accountability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contractor_id UUID NOT NULL UNIQUE,
    contractor_name VARCHAR(255) NOT NULL,

    -- Stock Summary (aggregated from pickings/consumptions/returns)
    total_issued_count INTEGER DEFAULT 0,
    total_issued_value DECIMAL(14,2) DEFAULT 0,
    total_consumed_count INTEGER DEFAULT 0,
    total_consumed_value DECIMAL(14,2) DEFAULT 0,
    total_returned_count INTEGER DEFAULT 0,
    total_returned_value DECIMAL(14,2) DEFAULT 0,

    -- Unaccounted (SOP 10.4: liable for lost/unaccounted)
    unaccounted_count INTEGER DEFAULT 0,
    unaccounted_value DECIMAL(14,2) DEFAULT 0,

    -- Current stock held by contractor's technicians
    current_held_count INTEGER DEFAULT 0,
    current_held_value DECIMAL(14,2) DEFAULT 0,

    -- Blocking Status (SOP 4.4: no new stock if previous unaccounted)
    is_blocked BOOLEAN DEFAULT false,
    blocked_reason TEXT,
    blocked_at TIMESTAMP WITH TIME ZONE,
    blocked_by VARCHAR(255),

    -- Recovery (SOP 10.5: financial recovery/set-off)
    pending_recovery_amount DECIMAL(14,2) DEFAULT 0,
    recovered_amount DECIMAL(14,2) DEFAULT 0,

    last_reconciliation_date TIMESTAMP WITH TIME ZONE,
    last_reconciliation_by VARCHAR(255),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_accountability_contractor ON contractor_stock_accountability(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_accountability_blocked ON contractor_stock_accountability(is_blocked);

COMMENT ON TABLE contractor_stock_accountability IS 'Stock accountability summary per contractor (SOP Section 10)';
COMMENT ON COLUMN contractor_stock_accountability.is_blocked IS 'If true, contractor cannot receive new stock issues (SOP 4.4)';
COMMENT ON COLUMN contractor_stock_accountability.pending_recovery_amount IS 'Amount to be recovered for lost/damaged stock (SOP 10.5)';

-- 2. Restore the trigger function WITH the restock-accountability block
--    (exact pre-392 prod body).
CREATE OR REPLACE FUNCTION public.trg_emit_serial_event_on_return_disposition()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_next_state    VARCHAR(50);
  v_event_type    VARCHAR(50);
  v_serial        RECORD;
  v_contractor_id UUID;
  v_contractor_nm VARCHAR(255);
BEGIN
  BEGIN
    -- Function-body guards mirror the trigger WHEN clause for defense in depth.
    IF NEW.disposition IS NULL
       OR NEW.disposition = OLD.disposition
       OR NEW.serial_id IS NULL THEN
      RETURN NEW;
    END IF;

    CASE NEW.disposition
      WHEN 'restock' THEN
        v_next_state := 'available';
        v_event_type := 'restocked';
      WHEN 'repair' THEN
        v_next_state := 'in_repair';
        v_event_type := 'sent_to_repair';
      WHEN 'scrap' THEN
        v_next_state := 'scrapped';
        v_event_type := 'scrapped';
      ELSE
        -- 'supplier_return' is valid in the CHECK but maps to no spec event —
        -- fall through to no-op (matches reviewer guidance).
        RETURN NEW;
    END CASE;

    SELECT id, status
    INTO   v_serial
    FROM   stock_serials
    WHERE  id = NEW.serial_id;

    IF NOT FOUND THEN
      RAISE NOTICE 'trg_emit_serial_event_on_return_disposition: serial_id % not found',
                   NEW.serial_id;
      RETURN NEW;
    END IF;

    INSERT INTO stock_serial_events (
      serial_id, event_type, from_state, to_state,
      source_table, source_id, payload, occurred_at)
    VALUES (
      NEW.serial_id,
      v_event_type,
      v_serial.status,
      v_next_state,
      'stock_return_lines',
      NEW.id,
      jsonb_build_object('disposition', NEW.disposition),
      NOW())
    ON CONFLICT (serial_id, source_table, source_id, event_type)
      WHERE source_id IS NOT NULL
      DO NOTHING;

    -- Restock-path no-downgrade guard (Important I2):
    -- a 'restock' must NOT un-scrap a scrapped serial. Other dispositions
    -- (repair → in_repair, scrap → scrapped) are progressions and are
    -- safe to apply unconditionally, except scrap is also blocked from
    -- overwriting an already-scrapped serial (a no-op either way).
    IF v_next_state = 'available' THEN
      UPDATE stock_serials
      SET    status     = v_next_state,
             updated_at = NOW()
      WHERE  id     = NEW.serial_id
        AND  status <> 'scrapped';
    ELSE
      UPDATE stock_serials
      SET    status     = v_next_state,
             updated_at = NOW()
      WHERE  id     = NEW.serial_id
        AND  status <> 'scrapped';
    END IF;

    -- Accountability: increment total_returned_count when disposition = 'restock'.
    IF NEW.disposition = 'restock' THEN
      -- Prefer the contractor recorded on the stock_returns row (NEW.return_id)
      -- because it's the actual returner; fall back to the most-recent done
      -- picking for this serial only if the return has no contractor.
      SELECT sr.contractor_id, sr.contractor_name
      INTO   v_contractor_id, v_contractor_nm
      FROM   stock_returns sr
      WHERE  sr.id = NEW.return_id
        AND  sr.contractor_id IS NOT NULL;

      IF v_contractor_id IS NULL THEN
        SELECT sp.contractor_id, sp.contractor_name
        INTO   v_contractor_id, v_contractor_nm
        FROM   stock_pickings sp
        JOIN   stock_picking_lines spl ON spl.picking_id = sp.id
        WHERE  NEW.serial_id = ANY(spl.serial_ids)
          AND  sp.status        = 'done'
          AND  sp.contractor_id IS NOT NULL
        ORDER  BY sp.done_at DESC NULLS LAST
        LIMIT  1;
      END IF;

      IF v_contractor_id IS NOT NULL THEN
        INSERT INTO contractor_stock_accountability
          (contractor_id, contractor_name, total_issued_count, total_returned_count)
        VALUES (
          v_contractor_id,
          COALESCE(v_contractor_nm, 'unknown'),
          0,
          1)
        ON CONFLICT (contractor_id) DO UPDATE
          SET total_returned_count =
                contractor_stock_accountability.total_returned_count + 1;
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trg_emit_serial_event_on_return_disposition: % — %', SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$function$;

-- 3. Remove the version-392 marker so the runner re-applies it on next deploy.
DELETE FROM migrations WHERE version = 392;

COMMIT;
