-- Migration 406: FT deduction auto-verifier — verdict columns
-- Purpose: persist an evidence-based verdict per weekly FT billing deduction
--          (ft_billing_deductions) so disputable deductions surface as
--          candidates in the Action Centre Disputes workflow instead of
--          being accepted at face value.
--            * verdict             — legitimate | disputable | insufficient_evidence
--            * verdict_evidence    — JSONB snapshot of the evidence the verdict
--                                    was computed from (signal, OES status,
--                                    fix history, DR record presence, ...)
--            * verdict_computed_at — when the verifier last ran for this row
-- note3 (Degraded) rows are monitor-only and keep verdict NULL.
-- Fully idempotent — safe to re-run.

ALTER TABLE ft_billing_deductions
  ADD COLUMN IF NOT EXISTS verdict             VARCHAR(30),
  ADD COLUMN IF NOT EXISTS verdict_evidence    JSONB,
  ADD COLUMN IF NOT EXISTS verdict_computed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ft_billing_deductions_verdict_check'
  ) THEN
    ALTER TABLE ft_billing_deductions
      ADD CONSTRAINT ft_billing_deductions_verdict_check
      CHECK (verdict IS NULL OR verdict IN ('legitimate', 'disputable', 'insufficient_evidence'));
  END IF;
END $$;

-- Dispute-candidate lookups: disputable rows of recent weeks, newest first.
CREATE INDEX IF NOT EXISTS idx_ft_ded_verdict_disputable
  ON ft_billing_deductions (week_ending DESC, project)
  WHERE verdict = 'disputable';
