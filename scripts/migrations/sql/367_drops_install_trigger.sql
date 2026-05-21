-- Migration 367: Add drops AFTER UPDATE OF ont_serial trigger.
--
-- Background (HOTFIX — PR-7 blind-review finding, 2026-05-21):
--   PR-7's Trigger 2 fires on qa_photo_reviews.ont_serial_scanned, but in
--   prod that column is populated in 0 of 8,299 rows. The trigger never emits
--   an event for any actual install. The canonical install fact in prod lives
--   on drops.ont_serial (17,722 populated rows).
--
-- Fix: add a NEW trigger trg_emit_serial_event_on_drop_install on
--   drops AFTER UPDATE OF ont_serial. The dormant qa_photo_reviews trigger
--   (Trigger 2) is left in place — it will activate if qa_photo_reviews ever
--   starts populating ont_serial_scanned.
--
-- Defense-in-depth: the WHEN clause on CREATE TRIGGER filters NULL/empty and
--   no-change updates before the function body is invoked. The function body
--   also guards these conditions internally (BEGIN/EXCEPTION WHEN OTHERS wrap).

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

INSERT INTO migrations (version, name)
  VALUES (367, 'drops_install_trigger')
  ON CONFLICT (version) DO NOTHING;
