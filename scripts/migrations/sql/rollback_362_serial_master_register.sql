-- Rollback Wave 1: Serial Master Register
-- Pre-rollback operational step: pg_dump stock_serials, stock_serial_events.

BEGIN;

DROP INDEX IF EXISTS uq_sse_dedupe;
DROP INDEX IF EXISTS idx_sse_source;
DROP INDEX IF EXISTS idx_sse_event_type;
DROP INDEX IF EXISTS idx_sse_serial_time;
DROP TABLE IF EXISTS stock_serial_events;

DROP INDEX IF EXISTS idx_ss_activated_olt;
DROP INDEX IF EXISTS idx_ss_allocated_project;
ALTER TABLE stock_serials DROP COLUMN IF EXISTS activated_at_olt_id;
ALTER TABLE stock_serials DROP COLUMN IF EXISTS allocated_to_project_id;

ALTER TABLE stock_serials DROP CONSTRAINT IF EXISTS stock_serials_status_check;
ALTER TABLE stock_serials ADD CONSTRAINT stock_serials_status_check CHECK (
  status IN ('available','reserved','in_transit','issued',
             'installed','returned','scrapped','faulty')
);

DELETE FROM migrations WHERE version = 362;

COMMIT;
