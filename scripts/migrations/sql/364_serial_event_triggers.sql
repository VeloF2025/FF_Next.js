-- Wave 1 PR-6: Serial Event Triggers + Accountability Fix
-- Spec:   docs/superpowers/specs/2026-05-21-serial-master-register-design.md
-- Probes: docs/superpowers/audits/2026-05-21-phase-4-probes.md
--
-- Schema reference (PROD, verified against migrations 027/028/029):
--   stock_picking_lines.serial_ids       UUID[]          (NOT stock_serial_id UUID)
--   stock_pickings.technician_id         UUID            (NOT staff_id)
--   stock_pickings.contractor_name       VARCHAR(255)    (required for accountability INSERT)
--   stock_return_lines.serial_id         UUID            (NOT stock_serial_id)
--   stock_returns.returned_by_id         UUID            (NOT staff_id)
--   stock_returns.contractor_id / contractor_name        (used for accountability)
--   stock_serials: NO current_holder_staff_id (use current_location_id if needed)
--   contractor_stock_accountability.contractor_name      NOT NULL — must be set on INSERT
--
-- Idempotent: all functions use CREATE OR REPLACE; triggers use DROP IF EXISTS + CREATE.

BEGIN;

-- ---------------------------------------------------------------------------
-- TRIGGER 1: stock_pickings AFTER UPDATE OF status → 'issued' / 'transferred'
--            + contractor_stock_accountability counter fix (PRD-027 §10)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_picking_done()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_serial_id  UUID;
  v_event_type VARCHAR(50);
  v_to_state   VARCHAR(50);
  v_count      INTEGER := 0;
BEGIN
  BEGIN
    -- Map picking_type → event_type/to_state.
    IF NEW.picking_type = 'transfer' THEN
      v_event_type := 'transferred';
      v_to_state   := 'in_transit';
    ELSE
      v_event_type := 'issued';
      v_to_state   := 'issued';
    END IF;

    -- Iterate every serial across all lines (UNNEST the serial_ids UUID[] array).
    FOR v_serial_id IN
      SELECT unnest(spl.serial_ids)
      FROM   stock_picking_lines spl
      WHERE  spl.picking_id      = NEW.id
        AND  spl.serial_ids     IS NOT NULL
        AND  array_length(spl.serial_ids, 1) > 0
    LOOP
      -- Insert event (idempotent via partial unique index uq_sse_dedupe).
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
        COALESCE(NEW.done_at, NOW())
      FROM stock_serials ss
      WHERE ss.id = v_serial_id
      ON CONFLICT (serial_id, source_table, source_id, event_type)
        WHERE source_id IS NOT NULL
        DO NOTHING;

      -- Update serial status — never downgrade from terminal states.
      UPDATE stock_serials
      SET    status     = v_to_state,
             updated_at = NOW()
      WHERE  id     = v_serial_id
        AND  status NOT IN ('faulty', 'scrapped', 'in_repair', 'returned');

      v_count := v_count + 1;
    END LOOP;

    -- PRD-027 §10: accountability counter (contractor pickings only).
    -- contractor_name is NOT NULL on contractor_stock_accountability; COALESCE
    -- protects against legacy rows where it wasn't populated.
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
$$;

DROP TRIGGER IF EXISTS emit_serial_event_on_picking_done ON stock_pickings;
CREATE TRIGGER emit_serial_event_on_picking_done
  AFTER UPDATE OF status ON stock_pickings
  FOR EACH ROW
  WHEN (NEW.status = 'done' AND OLD.status <> 'done')
  EXECUTE FUNCTION trg_emit_serial_event_on_picking_done();

-- ---------------------------------------------------------------------------
-- TRIGGER 2: qa_photo_reviews AFTER INSERT → 'installed_at_drop'
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_qa_install()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_serial RECORD;
BEGIN
  BEGIN
    IF NEW.ont_serial IS NULL OR NEW.drop_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT id, status, installed_at_drop_id
    INTO   v_serial
    FROM   stock_serials
    WHERE  serial_number = NEW.ont_serial
    LIMIT  1;

    IF NOT FOUND THEN
      RAISE NOTICE 'trg_emit_serial_event_on_qa_install: serial % not in stock_serials',
                   NEW.ont_serial;
      RETURN NEW;
    END IF;

    -- Insert event (idempotent via partial unique index).
    INSERT INTO stock_serial_events (
      serial_id, event_type, from_state, to_state,
      source_table, source_id, payload, occurred_at)
    VALUES (
      v_serial.id,
      'installed_at_drop',
      v_serial.status,
      'installed',
      'qa_photo_reviews',
      NEW.id,
      jsonb_build_object('drop_number', NEW.drop_number),
      COALESCE(NEW.created_at, NOW()))
    ON CONFLICT (serial_id, source_table, source_id, event_type)
      WHERE source_id IS NOT NULL
      DO NOTHING;

    -- Update serial only if not already in a terminal/later state and not yet installed.
    -- Status exclusion list includes 'in_repair' and 'returned' (Important I3 from
    -- the schema review — these are not terminal but installing-from-QA shouldn't
    -- overwrite them either).
    IF v_serial.status NOT IN ('activated', 'faulty', 'scrapped', 'in_repair', 'returned')
       AND v_serial.installed_at_drop_id IS NULL THEN
      UPDATE stock_serials
      SET    status               = 'installed',
             installed_at_drop_id = NEW.drop_id,
             updated_at           = NOW()
      WHERE  id = v_serial.id;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trg_emit_serial_event_on_qa_install: % — %', SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emit_serial_event_on_qa_install ON qa_photo_reviews;
CREATE TRIGGER emit_serial_event_on_qa_install
  AFTER INSERT ON qa_photo_reviews
  FOR EACH ROW
  EXECUTE FUNCTION trg_emit_serial_event_on_qa_install();

-- ---------------------------------------------------------------------------
-- TRIGGER 3: oes_pp_data AFTER INSERT → 'activated'
--            NOTE: uses olt_name (TEXT), not olt_id — per Probe 3 + PR-4.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_oes_activate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_serial RECORD;
BEGIN
  BEGIN
    IF NEW.serial_number IS NULL THEN
      RETURN NEW;
    END IF;

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
    -- COALESCE(NEW.activated_at, NOW()) per reviewer nit N1.
    INSERT INTO stock_serial_events (
      serial_id, event_type, from_state, to_state,
      source_table, source_id, payload, occurred_at)
    VALUES (
      v_serial.id,
      'activated',
      v_serial.status,
      'activated',
      'oes_pp_data',
      NEW.id,
      jsonb_build_object('olt_name', NEW.olt_name, 'pon_id', NEW.pon_id),
      COALESCE(NEW.activated_at, NOW()))
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

-- ---------------------------------------------------------------------------
-- TRIGGER 4: stock_returns AFTER INSERT → 'returned' for any lines already there
--            NOTE: return_lines may be empty at INSERT time (no-op is safe).
--            Trigger 4b below covers the case where lines are added later.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_return()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_line RECORD;
BEGIN
  BEGIN
    FOR v_line IN
      SELECT srl.serial_id, srl.id AS line_id, ss.status
      FROM   stock_return_lines srl
      JOIN   stock_serials ss ON ss.id = srl.serial_id
      WHERE  srl.return_id  = NEW.id
        AND  srl.serial_id IS NOT NULL
    LOOP
      INSERT INTO stock_serial_events (
        serial_id, event_type, from_state, to_state,
        source_table, source_id, actor_staff_id, payload, occurred_at)
      VALUES (
        v_line.serial_id,
        'returned',
        v_line.status,
        'returned',
        'stock_returns',
        NEW.id,
        NEW.returned_by_id,
        '{}'::jsonb,
        COALESCE(NEW.return_date, NEW.created_at, NOW()))
      ON CONFLICT (serial_id, source_table, source_id, event_type)
        WHERE source_id IS NOT NULL
        DO NOTHING;

      -- No-downgrade guard (Important I1) — preserve 'scrapped', 'faulty', 'in_repair'.
      UPDATE stock_serials
      SET    status     = 'returned',
             updated_at = NOW()
      WHERE  id     = v_line.serial_id
        AND  status NOT IN ('scrapped', 'faulty', 'in_repair');
    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trg_emit_serial_event_on_return: % — %', SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emit_serial_event_on_return ON stock_returns;
CREATE TRIGGER emit_serial_event_on_return
  AFTER INSERT ON stock_returns
  FOR EACH ROW
  EXECUTE FUNCTION trg_emit_serial_event_on_return();

-- ---------------------------------------------------------------------------
-- TRIGGER 4b: stock_return_lines AFTER INSERT → emit 'returned' for that line.
--             Handles the (common) case where lines are added after the return
--             header (Trigger 4 saw 0 lines at INSERT time).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_return_line_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_return RECORD;
  v_serial RECORD;
BEGIN
  BEGIN
    IF NEW.serial_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT returned_by_id, return_date, created_at
    INTO   v_return
    FROM   stock_returns
    WHERE  id = NEW.return_id;

    SELECT id, status
    INTO   v_serial
    FROM   stock_serials
    WHERE  id = NEW.serial_id;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    INSERT INTO stock_serial_events (
      serial_id, event_type, from_state, to_state,
      source_table, source_id, actor_staff_id, payload, occurred_at)
    VALUES (
      NEW.serial_id,
      'returned',
      v_serial.status,
      'returned',
      'stock_returns',
      NEW.return_id,
      v_return.returned_by_id,
      '{}'::jsonb,
      COALESCE(v_return.return_date, v_return.created_at, NOW()))
    ON CONFLICT (serial_id, source_table, source_id, event_type)
      WHERE source_id IS NOT NULL
      DO NOTHING;

    UPDATE stock_serials
    SET    status     = 'returned',
           updated_at = NOW()
    WHERE  id     = NEW.serial_id
      AND  status NOT IN ('scrapped', 'faulty', 'in_repair');

  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trg_emit_serial_event_on_return_line_insert: % — %', SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emit_serial_event_on_return_line_insert ON stock_return_lines;
CREATE TRIGGER emit_serial_event_on_return_line_insert
  AFTER INSERT ON stock_return_lines
  FOR EACH ROW
  EXECUTE FUNCTION trg_emit_serial_event_on_return_line_insert();

-- ---------------------------------------------------------------------------
-- TRIGGER 5: stock_return_lines AFTER UPDATE OF disposition →
--            restocked / sent_to_repair / scrapped
--            + accountability total_returned_count on 'restock'
--
-- CRITICAL: WHEN clause MUST reference NEW.serial_id (not stock_serial_id) —
-- PostgreSQL validates WHEN columns at CREATE TRIGGER time.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_return_disposition()
RETURNS trigger LANGUAGE plpgsql AS $$
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
$$;

DROP TRIGGER IF EXISTS emit_serial_event_on_return_disposition ON stock_return_lines;
CREATE TRIGGER emit_serial_event_on_return_disposition
  AFTER UPDATE OF disposition ON stock_return_lines
  FOR EACH ROW
  WHEN (NEW.disposition IS DISTINCT FROM OLD.disposition AND NEW.serial_id IS NOT NULL)
  EXECUTE FUNCTION trg_emit_serial_event_on_return_disposition();

-- ---------------------------------------------------------------------------
-- Migration record
-- ---------------------------------------------------------------------------
INSERT INTO migrations (version, name)
  VALUES (364, 'serial_event_triggers')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
