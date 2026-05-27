-- Rollback 365: Restore Trigger 2 + Trigger 3 to their migration-364 shapes.
-- WARNING: Rolling back restores the broken column references (ont_serial,
-- drop_id, pon_id, activated_at). After rollback, both triggers will silently
-- no-op on every insert (EXCEPTION WHEN OTHERS swallows the 42703 errors).
-- Only roll back if migration 365 itself caused a regression.

BEGIN;

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

DELETE FROM migrations WHERE version = 365;

COMMIT;
