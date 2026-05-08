-- Migration 245: Park (on-hold) state for approval requests
-- Allows approvers to put a request on hold without rejecting; can be resumed later.

-- 1. Allow 'on_hold' as a status
ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_status_check;
ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'escalated', 'skipped', 'cancelled', 'on_hold'));

-- 2. Park metadata
ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS parked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parked_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS parked_by_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS park_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_ar_on_hold ON approval_requests(status, assigned_to)
  WHERE status = 'on_hold';

-- 3. Allow 'parked' / 'resumed' actions in approval_history
ALTER TABLE approval_history DROP CONSTRAINT IF EXISTS approval_history_action_check;
ALTER TABLE approval_history ADD CONSTRAINT approval_history_action_check
  CHECK (action IN (
    'created', 'assigned', 'viewed', 'approved', 'rejected',
    'escalated', 'delegated', 'skipped', 'cancelled', 'reminded',
    'parked', 'resumed'
  ));

-- 4. Update audit trigger to map on_hold transitions to parked/resumed actions,
--    and to attribute the action to the parker (parked_by) rather than the assignee.
CREATE OR REPLACE FUNCTION public.log_approval_action()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO approval_history (
            approval_request_id, action, performed_by, performed_by_name,
            to_status, notes
        ) VALUES (
            NEW.id, 'created', NEW.requested_by, NEW.requested_by_name,
            NEW.status, NEW.request_notes
        );
    ELSIF TG_OP = 'UPDATE' AND OLD.status <> NEW.status THEN
        INSERT INTO approval_history (
            approval_request_id, action, performed_by, performed_by_name,
            from_status, to_status, notes
        ) VALUES (
            NEW.id,
            CASE
                WHEN NEW.status = 'approved'  THEN 'approved'
                WHEN NEW.status = 'rejected'  THEN 'rejected'
                WHEN NEW.status = 'escalated' THEN 'escalated'
                WHEN NEW.status = 'skipped'   THEN 'skipped'
                WHEN NEW.status = 'cancelled' THEN 'cancelled'
                WHEN NEW.status = 'on_hold'   THEN 'parked'
                WHEN OLD.status = 'on_hold' AND NEW.status = 'pending' THEN 'resumed'
                ELSE 'assigned'
            END,
            CASE
                WHEN NEW.status = 'on_hold' THEN COALESCE(NEW.parked_by, NEW.responded_by, NEW.assigned_to, NEW.requested_by)
                ELSE COALESCE(NEW.responded_by, NEW.assigned_to, NEW.requested_by)
            END,
            CASE
                WHEN NEW.status = 'on_hold' THEN COALESCE(NEW.parked_by_name, NEW.responded_by_name, NEW.assigned_to_name, NEW.requested_by_name)
                ELSE COALESCE(NEW.responded_by_name, NEW.assigned_to_name, NEW.requested_by_name)
            END,
            OLD.status,
            NEW.status,
            CASE
                WHEN NEW.status = 'on_hold' THEN NEW.park_reason
                ELSE NEW.response_notes
            END
        );
    END IF;
    RETURN NEW;
END;
$function$;
