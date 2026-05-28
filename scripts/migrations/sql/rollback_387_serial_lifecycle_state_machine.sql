-- Rollback 387: drop new triggers + tables; restore 11-value CHECK; un-rename in_stock.
--
-- Track 2.7 update: mig 387 (with the Track 2.7 DROP block appended) retires
-- the three legacy per-source emit triggers at cutover time.  This rollback
-- must therefore RE-INSTALL those three triggers so the system is left with
-- the same trigger set that existed before mig 387 was applied.
--
-- Function bodies are copied verbatim from their LATEST definitions:
--   trg_emit_serial_event_on_picking_done()  ← mig 366 (366_fix_picking_trigger_done_at.sql)
--   trg_emit_serial_event_on_oes_activate()  ← mig 365 (365_fix_qa_oes_triggers.sql, TRIGGER 3 FIX block)
--   trg_emit_serial_event_on_drop_install()  ← mig 367 (367_drops_install_trigger.sql)
--
-- The two retained triggers (emit_serial_event_on_qa_install,
-- emit_serial_event_on_return) are still installed after mig 387 runs, so
-- they do NOT need to be re-created here.
--
-- Ordering: drop the mig 387 generic triggers first (they are the replacements),
-- then re-install the legacy ones so the DB is left in the pre-387 state.

BEGIN;

-- ─── Drop mig 387 generic triggers + functions ─────────────────────────────────

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

-- ─── Re-install legacy trigger 1: trg_emit_serial_event_on_picking_done ────────
-- Source: mig 366 (366_fix_picking_trigger_done_at.sql) — LATEST definition.
-- Fixes: COALESCE(signed_at, effective_date, approved_at, NOW()) replaces the
--        invalid NEW.done_at reference that was in mig 364.

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

DROP TRIGGER IF EXISTS emit_serial_event_on_picking_done ON stock_pickings;
CREATE TRIGGER emit_serial_event_on_picking_done
  AFTER UPDATE OF status ON stock_pickings
  FOR EACH ROW
  WHEN (NEW.status = 'done' AND OLD.status <> 'done')
  EXECUTE FUNCTION trg_emit_serial_event_on_picking_done();

-- ─── Re-install legacy trigger 3: trg_emit_serial_event_on_oes_activate ────────
-- Source: mig 365 (365_fix_qa_oes_triggers.sql, TRIGGER 3 FIX block) — LATEST definition.
-- Fixes: md5(id::text)::uuid for source_id (oes_pp_data.id is INTEGER not UUID),
--        olt_pon instead of pon_id, created_at instead of activated_at.

CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_oes_activate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_serial    RECORD;
  v_source_id UUID;
BEGIN
  BEGIN
    IF NEW.serial_number IS NULL THEN
      RETURN NEW;
    END IF;

    -- Prod schema (PR-7): oes_pp_data.id is INTEGER, not UUID.
    -- Derive a deterministic UUID via md5 so the uq_sse_dedupe index works.
    v_source_id := md5(NEW.id::text)::uuid;

    SELECT id, status
    INTO   v_serial
    FROM   stock_serials
    WHERE  serial_number = NEW.serial_number
    LIMIT  1;

    IF NOT FOUND THEN
      RAISE NOTICE 'trg_emit_serial_event_on_oes_activate: serial % not in stock_serials',
                   NEW.serial_number;
      RETURN NEW;
    END IF;

    -- Insert event (idempotent via partial unique index).
    -- Prod: no activated_at column — use created_at.
    -- Prod: no pon_id column — use olt_pon (smallint cast to text) if present.
    INSERT INTO stock_serial_events (
      serial_id, event_type, from_state, to_state,
      source_table, source_id, payload, occurred_at)
    VALUES (
      v_serial.id,
      'activated',
      v_serial.status,
      'activated',
      'oes_pp_data',
      v_source_id,
      jsonb_build_object(
        'olt_name', NEW.olt_name,
        'olt_pon',  NEW.olt_pon::text,
        'oes_id',   NEW.id),
      COALESCE(NEW.created_at, NOW()))
    ON CONFLICT (serial_id, source_table, source_id, event_type)
      WHERE source_id IS NOT NULL
      DO NOTHING;

    -- Update serial only if currently in a lower-precedence state.
    IF v_serial.status IN ('available', 'installed', 'issued') THEN
      UPDATE stock_serials
      SET    status              = 'activated',
             activated_at_olt_id = NEW.olt_name,
             updated_at          = NOW()
      WHERE  id = v_serial.id;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trg_emit_serial_event_on_oes_activate: % — %', SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emit_serial_event_on_oes_activate ON oes_pp_data;
CREATE TRIGGER emit_serial_event_on_oes_activate
  AFTER INSERT ON oes_pp_data
  FOR EACH ROW
  EXECUTE FUNCTION trg_emit_serial_event_on_oes_activate();

-- ─── Re-install legacy trigger: trg_emit_serial_event_on_drop_install ──────────
-- Source: mig 367 (367_drops_install_trigger.sql) — full definition (this trigger
-- did not exist before mig 367, so there is only one version).

CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_drop_install()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_serial RECORD;
BEGIN
  -- Skip if ont_serial isn't actually being set or changing
  IF NEW.ont_serial IS NULL OR NEW.ont_serial = '' THEN
    RETURN NEW;
  END IF;
  IF OLD.ont_serial IS NOT DISTINCT FROM NEW.ont_serial THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT id, status, installed_at_drop_id
      INTO v_serial
      FROM stock_serials
     WHERE serial_number = NEW.ont_serial
     LIMIT 1;

    -- Unknown serial — log notice, no event
    IF NOT FOUND THEN
      RAISE NOTICE 'trg_emit_serial_event_on_drop_install: serial % not in stock_serials', NEW.ont_serial;
      RETURN NEW;
    END IF;

    INSERT INTO stock_serial_events
      (serial_id, event_type, from_state, to_state, source_table,
       source_id, occurred_at, payload)
    VALUES
      (v_serial.id, 'installed_at_drop', v_serial.status, 'installed',
       'drops', NEW.id, COALESCE(NEW.installed_at, NOW()),
       jsonb_build_object('drop_number', NEW.drop_number))
    ON CONFLICT (serial_id, source_table, source_id, event_type)
      WHERE source_id IS NOT NULL
    DO NOTHING;

    -- Status update: only promote pre-install states; never overwrite terminal
    -- states or an existing installed_at_drop_id (avoid double-install).
    IF v_serial.status NOT IN ('activated','faulty','scrapped','in_repair','returned')
       AND v_serial.installed_at_drop_id IS NULL THEN
      UPDATE stock_serials
         SET status = 'installed',
             installed_at_drop_id = NEW.id,
             installed_at_drop_number = NEW.drop_number,
             updated_at = NOW()
       WHERE id = v_serial.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trg_emit_serial_event_on_drop_install error: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emit_serial_event_on_drop_install ON drops;
CREATE TRIGGER emit_serial_event_on_drop_install
  AFTER UPDATE OF ont_serial ON drops
  FOR EACH ROW
  WHEN (NEW.ont_serial IS NOT NULL AND NEW.ont_serial <> ''
        AND (OLD.ont_serial IS NULL OR OLD.ont_serial <> NEW.ont_serial))
  EXECUTE FUNCTION trg_emit_serial_event_on_drop_install();

-- ─── Remove migration record ───────────────────────────────────────────────────

DELETE FROM migrations WHERE version = '387';

COMMIT;
