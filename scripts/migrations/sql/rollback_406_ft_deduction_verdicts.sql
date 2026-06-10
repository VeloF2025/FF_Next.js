-- Rollback for migration 406: FT deduction auto-verifier — verdict columns

DROP INDEX IF EXISTS idx_ft_ded_verdict_disputable;

ALTER TABLE ft_billing_deductions
  DROP CONSTRAINT IF EXISTS ft_billing_deductions_verdict_check;

ALTER TABLE ft_billing_deductions
  DROP COLUMN IF EXISTS verdict,
  DROP COLUMN IF EXISTS verdict_evidence,
  DROP COLUMN IF EXISTS verdict_computed_at;
