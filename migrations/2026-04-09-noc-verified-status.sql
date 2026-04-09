-- Add 'verified' status to maintenance_statuses lookup table
INSERT INTO maintenance_statuses (code, name, color, display_order, description)
VALUES ('verified', 'Verified', 'success', 105, 'Resolution verified by team lead — ready to close')
ON CONFLICT (code) DO NOTHING;

-- Update CHECK constraint on maintenance_tickets to include 'verified'
-- (only if a CHECK constraint exists — check pg_constraint first)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'maintenance_tickets_status_check'
    AND conrelid = 'maintenance_tickets'::regclass
  ) THEN
    ALTER TABLE maintenance_tickets DROP CONSTRAINT maintenance_tickets_status_check;
    ALTER TABLE maintenance_tickets ADD CONSTRAINT maintenance_tickets_status_check
      CHECK (status IN ('open','assigned','in_progress','pending_qa','qa_in_progress','qa_rejected','qa_approved','pending_handover','handed_to_ops','resolved','verified','closed','cancelled'));
  END IF;
END $$;
