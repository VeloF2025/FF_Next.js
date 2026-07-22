-- Rollback 448: drop the FT daily-eligibility columns.
BEGIN;
ALTER TABLE oes_activations DROP COLUMN IF EXISTS payment_eligibility;
ALTER TABLE oes_activations DROP COLUMN IF EXISTS not_eligible_reason;
COMMIT;
