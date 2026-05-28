-- Migration 386: Guard the install-event INSERT against lifecycle regression.
--
-- Background (drift triage, 2026-05-28):
--   `latest_event_matches_status` reconcile flagged 19 ONT serials where
--   `stock_serials.status='activated'` but the most recent event was
--   `installed_at_drop` (to_state='installed'). Root cause: the trigger from
--   mig 367 (`trg_emit_serial_event_on_drop_install`) has a guard on the
--   status UPDATE (lines 57-58 of the original) that correctly skips
--   regression when status is already terminal/activated, but the event
--   INSERT above it has NO matching guard — so it still writes a row whose
--   to_state='installed' for a serial that's already activated.
--
--   In the field workflow, OES often picks up activation BEFORE the drops
--   table gets the ont_serial filled in. When the drops row finally updates,
--   this trigger fires and logs a `from_state='activated', to_state='installed'`
--   event that lies about a transition that never happened.
--
-- Fix: skip the event INSERT entirely when the serial is in a terminal/post-
--   install state. This keeps the audit log honest. The drops-side install
--   fact (ont_serial fill) is still recorded on the drops row; it just
--   doesn't get duplicated as a fake regression on the serial ledger.

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

    -- Skip both event and status update if the serial is past the install
    -- step (activated/faulty/scrapped/in_repair/returned) or already has an
    -- install drop id recorded. Out-of-order data arrival (OES first, drops
    -- later) would otherwise log a phantom installed_at_drop event whose
    -- to_state contradicts the canonical status.
    IF v_serial.status IN ('activated','faulty','scrapped','in_repair','returned')
       OR v_serial.installed_at_drop_id IS NOT NULL THEN
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

    UPDATE stock_serials
       SET status = 'installed',
           installed_at_drop_id = NEW.id,
           installed_at_drop_number = NEW.drop_number,
           updated_at = NOW()
     WHERE id = v_serial.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trg_emit_serial_event_on_drop_install error: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

INSERT INTO migrations (version, name)
  VALUES (386, 'drops_install_trigger_event_guard')
  ON CONFLICT (version) DO NOTHING;
