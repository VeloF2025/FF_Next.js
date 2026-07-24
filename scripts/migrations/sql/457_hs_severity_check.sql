-- 457: enforce the unified H&S incident severity vocabulary at the DB (goal §4.9)
--
-- The code dropped 'fatal' in favour of critical|major|moderate|minor, but
-- hs_ticket_details.severity had no CHECK — so a 'fatal' row written by any
-- other path (restore, admin tooling, a revert) would silently fail-open the
-- contractor gate's incident filter. This adds the constraint the vocabulary
-- always implied. Safe: hs_ticket_details is empty (emptied at gate G2), and
-- live incident severities are already critical|major|moderate|minor.
--
-- Idempotent (guarded ADD CONSTRAINT). Rollback: rollback_457_hs_severity_check.sql.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hs_ticket_details_severity_check'
  ) THEN
    ALTER TABLE hs_ticket_details
      ADD CONSTRAINT hs_ticket_details_severity_check
      CHECK (severity IS NULL OR severity IN ('critical','major','moderate','minor'));
  END IF;
END $$;

COMMIT;
