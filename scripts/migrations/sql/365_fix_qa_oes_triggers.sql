-- Migration 365: Fix Trigger 2 (qa_photo_reviews) + Trigger 3 (oes_pp_data)
-- against actual prod schema.
--
-- Background (PR-7 probes, 2026-05-21):
--   Migration 364 shipped these two trigger functions with column names that
--   do not exist in prod:
--
--   Trigger 2 (trg_emit_serial_event_on_qa_install):
--     NEW.ont_serial  → prod column is ont_serial_scanned
--     NEW.drop_id     → no drop_id FK on qa_photo_reviews; derive from drops.drop_number
--
--   Trigger 3 (trg_emit_serial_event_on_oes_activate):
--     NEW.pon_id      → no pon_id column; nearest equivalent is olt_pon (smallint)
--     NEW.activated_at → no such column; use created_at
--     NEW.id as source_id UUID → oes_pp_data.id is INTEGER, not UUID;
--                                 use md5(id::text)::uuid for deterministic mapping
--
-- Because both functions use EXCEPTION WHEN OTHERS the prod INSERT still
-- succeeds, but the trigger body is silently no-oping — events are never
-- emitted for qa_photo_reviews or oes_pp_data rows.
--
-- This migration replaces both functions in-place (CREATE OR REPLACE).
-- Idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- TRIGGER 2 FIX: qa_photo_reviews — ont_serial_scanned + drop_number → id
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_qa_install()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_serial  RECORD;
  v_drop_id UUID;
BEGIN
  BEGIN
    -- Prod schema (PR-7): ont_serial_scanned is the serial column.
    -- qa_photo_reviews has no drop_id FK — resolve from drops via drop_number.
    IF NEW.ont_serial_scanned IS NULL OR NEW.drop_number IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT id INTO v_drop_id
    FROM   drops
    WHERE  drop_number = NEW.drop_number
    LIMIT  1;

    IF v_drop_id IS NULL THEN
      RAISE NOTICE 'trg_emit_serial_event_on_qa_install: drop_number % not in drops',
                   NEW.drop_number;
      RETURN NEW;
    END IF;

    SELECT id, status, installed_at_drop_id
    INTO   v_serial
    FROM   stock_serials
    WHERE  serial_number = NEW.ont_serial_scanned
    LIMIT  1;

    IF NOT FOUND THEN
      RAISE NOTICE 'trg_emit_serial_event_on_qa_install: serial % not in stock_serials',
                   NEW.ont_serial_scanned;
      RETURN NEW;
    END IF;

    -- Insert event (idempotent via partial unique index uq_sse_dedupe).
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
    IF v_serial.status NOT IN ('activated', 'faulty', 'scrapped', 'in_repair', 'returned')
       AND v_serial.installed_at_drop_id IS NULL THEN
      UPDATE stock_serials
      SET    status               = 'installed',
             installed_at_drop_id = v_drop_id,
             updated_at           = NOW()
      WHERE  id = v_serial.id;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trg_emit_serial_event_on_qa_install: % — %', SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- TRIGGER 3 FIX: oes_pp_data — olt_pon (not pon_id), created_at (not
--                activated_at), and md5(id::text)::uuid for source_id
-- ---------------------------------------------------------------------------

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

INSERT INTO migrations (version, name)
  VALUES (365, 'fix_qa_oes_triggers')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
