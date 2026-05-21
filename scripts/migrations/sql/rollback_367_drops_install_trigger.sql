-- Rollback for migration 367: drops_install_trigger
--
-- Removes the drops AFTER UPDATE OF ont_serial trigger and its backing function.
-- The dormant qa_photo_reviews trigger (Trigger 2, migration 365) is unaffected.

DROP TRIGGER IF EXISTS emit_serial_event_on_drop_install ON drops;
DROP FUNCTION IF EXISTS trg_emit_serial_event_on_drop_install();

DELETE FROM migrations WHERE version = 367;
