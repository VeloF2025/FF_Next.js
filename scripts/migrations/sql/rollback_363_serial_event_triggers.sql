-- Rollback for migration 363: serial_event_triggers
-- Removes all triggers (5 primary + 1 return_line insert) and their backing functions.

BEGIN;

DROP TRIGGER IF EXISTS emit_serial_event_on_picking_done         ON stock_pickings;
DROP TRIGGER IF EXISTS emit_serial_event_on_qa_install           ON qa_photo_reviews;
DROP TRIGGER IF EXISTS emit_serial_event_on_oes_activate         ON oes_pp_data;
DROP TRIGGER IF EXISTS emit_serial_event_on_return               ON stock_returns;
DROP TRIGGER IF EXISTS emit_serial_event_on_return_line_insert   ON stock_return_lines;
DROP TRIGGER IF EXISTS emit_serial_event_on_return_disposition   ON stock_return_lines;

DROP FUNCTION IF EXISTS trg_emit_serial_event_on_picking_done();
DROP FUNCTION IF EXISTS trg_emit_serial_event_on_qa_install();
DROP FUNCTION IF EXISTS trg_emit_serial_event_on_oes_activate();
DROP FUNCTION IF EXISTS trg_emit_serial_event_on_return();
DROP FUNCTION IF EXISTS trg_emit_serial_event_on_return_line_insert();
DROP FUNCTION IF EXISTS trg_emit_serial_event_on_return_disposition();

DELETE FROM migrations WHERE version = 363;

COMMIT;
