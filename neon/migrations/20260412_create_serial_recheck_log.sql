-- Migration: 20260412_create_serial_recheck_log
-- Creates audit log table for serial mismatch recheck operations

CREATE TABLE IF NOT EXISTS serial_recheck_log (
  id                      SERIAL PRIMARY KEY,
  drop_number             TEXT NOT NULL,
  triggered_by            TEXT NOT NULL CHECK (triggered_by IN ('auto', 'manual')),
  rechecker_user_id       TEXT,
  recheck_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  serial_type             TEXT NOT NULL CHECK (serial_type IN ('ups', 'ont', 'both')),
  first_pass_serial       TEXT,
  second_pass_serial      TEXT,
  second_pass_confidence  NUMERIC(4,3),
  outcome                 TEXT NOT NULL CHECK (outcome IN ('correction', 'verify', 'unclear')),
  onemap_serial           TEXT,
  wa_message_sent         BOOLEAN NOT NULL DEFAULT FALSE,
  wa_message_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS serial_recheck_log_drop_number_idx
  ON serial_recheck_log (drop_number);

CREATE INDEX IF NOT EXISTS serial_recheck_log_recheck_at_idx
  ON serial_recheck_log (recheck_at DESC);
