-- Migration 392: Drop contractor_stock_accountability (Sprint E — Track 4.5)
-- Spec: docs/superpowers/specs/2026-05-28-serial-lifecycle-state-machine-sprintE-design.md
--
-- The contractor_stock_accountability (CSA) counter table is fully superseded by
-- the live v_contractor_accountability view (mig 391). By Track 4.4 every reader
-- had migrated off it; the table is empty in prod (0 rows) and no view or FK
-- references it. The only remaining WRITER is the restock-accountability block in
-- trg_emit_serial_event_on_return_disposition (the picking-done counter block was
-- already removed in Sprint D). This migration strips that last write, then drops
-- the table.
--
-- Cutover-gated for the SAME reason as mig 387: the dev+prod DB is shared, so this
-- migration mutates production the instant it runs. It is therefore guarded by the
-- __sprint_e_cutover_gate__ marker and only applies inside the Sprint E cutover
-- window (after 387, before backfill --commit). Merging this PR does not change any
-- environment until that marker table is created per docs/runbooks/sprint-e-cutover.md.

BEGIN;

-- 0. Cutover atomicity gate (mirrors mig 387). Without the marker table this
--    RAISE EXCEPTION aborts the txn and the schema stays untouched.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename  = '__sprint_e_cutover_gate__'
  ) THEN
    RAISE EXCEPTION
      'mig 392 cannot run until __sprint_e_cutover_gate__ marker table exists. '
      'It is part of the Sprint E cutover and runs after mig 387 — see '
      'docs/runbooks/sprint-e-cutover.md.';
  END IF;
END$$;

-- 1. Strip the residual contractor_stock_accountability write from the
--    return-disposition trigger. Body is otherwise identical to mig 364 / the
--    current prod definition; only the restock "Accountability:" block and its
--    two local variables (v_contractor_id, v_contractor_nm) are removed.
CREATE OR REPLACE FUNCTION public.trg_emit_serial_event_on_return_disposition()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_next_state    VARCHAR(50);
  v_event_type    VARCHAR(50);
  v_serial        RECORD;
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

  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trg_emit_serial_event_on_return_disposition: % — %', SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$function$;

-- 2. Drop the now-unreferenced counter table. Empty in prod; no view/FK depends
--    on it (verified against the live DB). reconcile-queries.sql had its two
--    accountability_*_counter_drift checks removed in the same PR.
DROP TABLE IF EXISTS contractor_stock_accountability;

INSERT INTO migrations (version, name)
  VALUES (392, 'drop_contractor_stock_accountability')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
