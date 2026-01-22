-- ============================================================
-- Migration 100: Fix create_ticket_history Trigger Function
-- ============================================================
-- The table was renamed from ticket_history to maintenance_history
-- in migration 091, but the trigger function was not updated.
-- This migration fixes the function to reference the correct table.
-- ============================================================

BEGIN;

-- Update the create_ticket_history function to use maintenance_history
CREATE OR REPLACE FUNCTION create_ticket_history()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO maintenance_history (ticket_id, action, new_value, changed_by, changed_at)
    VALUES (NEW.id, 'created', jsonb_build_object('status', NEW.status, 'priority', NEW.priority)::TEXT, NEW.created_by, NEW.created_at);

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != NEW.status THEN
      INSERT INTO maintenance_history (ticket_id, action, field_changed, old_value, new_value, changed_by)
      VALUES (NEW.id, 'status_changed', 'status', OLD.status, NEW.status, NEW.created_by);
    END IF;

    IF OLD.priority != NEW.priority THEN
      INSERT INTO maintenance_history (ticket_id, action, field_changed, old_value, new_value, changed_by)
      VALUES (NEW.id, 'priority_changed', 'priority', OLD.priority, NEW.priority, NEW.created_by);
    END IF;

    IF (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN
      INSERT INTO maintenance_history (ticket_id, action, field_changed, old_value, new_value, changed_by)
      VALUES (NEW.id, 'assigned', 'assigned_to', OLD.assigned_to::TEXT, NEW.assigned_to::TEXT, NEW.created_by);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add comment to document the function
COMMENT ON FUNCTION create_ticket_history() IS 'Trigger function to record ticket changes in maintenance_history table';

COMMIT;
