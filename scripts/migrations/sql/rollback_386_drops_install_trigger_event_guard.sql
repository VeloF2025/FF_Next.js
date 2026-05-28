-- Rollback 386: restore mig 367's trigger function (event INSERT runs even
-- when status guard would skip the UPDATE).

CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_drop_install()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_serial RECORD;
BEGIN
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

DELETE FROM migrations WHERE version = '386';
