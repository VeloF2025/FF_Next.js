-- Wave 1: Serial Master Register
-- Spec:   docs/superpowers/specs/2026-05-21-serial-master-register-design.md
-- Probes: docs/superpowers/audits/2026-05-21-phase-4-probes.md
-- Idempotent: every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE.

BEGIN;

-- (a) Extend stock_serials.status CHECK.
-- Per Probe 1: existing 8 values are below; appending the 3 new ones.
ALTER TABLE stock_serials DROP CONSTRAINT IF EXISTS stock_serials_status_check;
ALTER TABLE stock_serials ADD CONSTRAINT stock_serials_status_check CHECK (
  status IN (
    'available',
    'reserved',
    'allocated_to_project',     -- NEW
    'in_transit',
    'issued',
    'installed',
    'activated',                -- NEW
    'faulty',
    'in_repair',                -- NEW
    'returned',
    'scrapped'
  )
);

-- (b) New columns on stock_serials.
-- allocated_to_project_id references projects(id) (Probe 2: uuid NOT NULL).
-- activated_at_olt_id is TEXT (Probe 3: no olts table; stores olt_name).
ALTER TABLE stock_serials
  ADD COLUMN IF NOT EXISTS allocated_to_project_id UUID REFERENCES projects(id),
  ADD COLUMN IF NOT EXISTS activated_at_olt_id     TEXT;

CREATE INDEX IF NOT EXISTS idx_ss_allocated_project
  ON stock_serials(allocated_to_project_id);
CREATE INDEX IF NOT EXISTS idx_ss_activated_olt
  ON stock_serials(activated_at_olt_id);

-- (c) Event log.
CREATE TABLE IF NOT EXISTS stock_serial_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_id       UUID NOT NULL REFERENCES stock_serials(id),
  event_type      VARCHAR(50) NOT NULL,
  from_state      VARCHAR(50),
  to_state        VARCHAR(50),
  source_table    VARCHAR(50),
  source_id       UUID,
  actor_user_id   UUID REFERENCES users(id),
  actor_staff_id  UUID REFERENCES staff(id),
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sse_serial_time
  ON stock_serial_events(serial_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sse_event_type
  ON stock_serial_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sse_source
  ON stock_serial_events(source_table, source_id);

-- Backfill scripts D+E rely on this composite key for idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sse_dedupe
  ON stock_serial_events(serial_id, source_table, source_id, event_type)
  WHERE source_id IS NOT NULL;

INSERT INTO migrations (version, name)
  VALUES (362, 'serial_master_register')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
