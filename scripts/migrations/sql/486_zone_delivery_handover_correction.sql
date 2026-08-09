-- 486_zone_delivery_handover_correction.sql
--
-- Allow an operator-declared zone handover date to be corrected.
--
-- Migration 470 made handed_over_at immutable once recorded, on the assumption
-- that handover is DERIVED — stamped automatically the moment every gate passed,
-- so the date could only ever be "now" and could never be wrong.
--
-- Handover is now also DECLARED: on legacy sites the zone was handed over before
-- FibreFlow tracked it, the FAC is signed on one date and uploaded on another,
-- and the operator supplies the business date himself. A date entered by hand
-- will sometimes be wrong, and a permanently-wrong date in a compliance register
-- is worse than an audited correction.
--
-- The invariant is narrowed rather than dropped. Every existing path still fails
-- exactly as before; only a transaction that explicitly opts in may re-date, and
-- opting in requires setting a transaction-local GUC, which no derived path,
-- migration, backfill or ad-hoc UPDATE does. This mirrors the gated-edit pattern
-- already used by 387_serial_lifecycle_state_machine.sql (ff.bypass_validation).
--
-- `IS DISTINCT FROM` is deliberate: an unset GUC reads as NULL, and a plain
-- `<> 'true'` comparison against NULL yields NULL, which would skip the RAISE and
-- silently make the column mutable for everyone — the exact inversion of intent.

CREATE OR REPLACE FUNCTION protect_zone_delivery_handover()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.handed_over_at IS NOT NULL
     AND (
       NEW.handed_over_at IS DISTINCT FROM OLD.handed_over_at
       OR NEW.handover_snapshot IS DISTINCT FROM OLD.handover_snapshot
     )
     AND current_setting('ff.zone_handover_correction', true) IS DISTINCT FROM 'true'
  THEN
    RAISE EXCEPTION 'handed_over_at is immutable once recorded'
      USING HINT = 'Corrections must go through the declare-handover command, which sets ff.zone_handover_correction';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger itself is unchanged and still bound to this function; recreating
-- it would be a no-op. Left in place deliberately.
