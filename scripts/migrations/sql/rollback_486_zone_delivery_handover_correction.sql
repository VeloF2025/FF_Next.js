-- rollback_486_zone_delivery_handover_correction.sql
--
-- Restore migration 470's unconditional handover immutability.
--
-- Rerunnable: CREATE OR REPLACE FUNCTION restores the original body whether or
-- not 485 was applied. After this runs, the declare-handover command's
-- correction path will fail with 'handed_over_at is immutable once recorded' —
-- that is the intended pre-485 behaviour, not a regression.
--
-- Already-corrected rows are NOT reverted; this only restores the guard.

CREATE OR REPLACE FUNCTION protect_zone_delivery_handover()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.handed_over_at IS NOT NULL
     AND (
       NEW.handed_over_at IS DISTINCT FROM OLD.handed_over_at
       OR NEW.handover_snapshot IS DISTINCT FROM OLD.handover_snapshot
     ) THEN
    RAISE EXCEPTION 'handed_over_at is immutable once recorded';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Without this the runner still believes the migration is applied (it decides
-- pending-ness from this table alone), so a rollback leaves the database on
-- migration 470's semantics while no deploy will ever re-apply 486. The
-- declare-handover correction path then fails permanently with
-- 'handed_over_at is immutable once recorded', recoverable only by deleting
-- this row by hand. Migrations 470, 483 and 484 all do this; 485/486 did not.
DELETE FROM schema_migrations
WHERE filename IN (
  '486_zone_delivery_handover_correction.sql',
  -- The pre-renumber name, so a rollback still works on a database that
  -- recorded this migration before it moved off the colliding 485.
  '485_zone_delivery_handover_correction.sql'
);

